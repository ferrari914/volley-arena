/**
 * 카드 한 장을 3중 1택 화면에 세워 찍는 도구다 (DESIGN 4번 · 8번).
 *
 *   npm run shot:card -- repel            # 밀어내기가 낀 카드 화면 (모바일·데스크톱)
 *   npm run shot:card -- repel mend       # 여러 장을 잇달아
 *   npm run shot:card -- repel mobile     # 한쪽 화면만
 *
 * **왜 `npm run qa`로는 안 되는가**: qa도 카드 화면을 찍지만, 그 화면에 어느 세 장이
 * 뜨는지는 판이 정한다(`rollUpgradeChoices`는 가진 카드 전부에서 섞어 셋을 뽑는다).
 * 새로 넣은 카드가 그 셋에 드는지는 운이므로, **방금 만든 카드를 눈으로 보는 방법이 없다.**
 *
 * **왜 파일로 두는가**: 세션 53이 밀어내기 카드를 넣으면서 이것과 같은 하네스를
 * 저장소 뿌리에 임시로 짰다(`card-shot.tmp.mjs`). 짜서 버리면 다음 세션이 같은 화면을
 * 다시 못 만들고, 지난 세션이 무엇을 보고 판단했는지 재현할 수 없다 — 적 쪽에서 이미
 * 두 번 겪고 도구로 굳힌 일이다(`tools/enemy-shot.mjs` 머리말 · STATUS 세션 21·22·52).
 * 그 임시 하네스는 **나머지 카드를 최대까지 고른 것으로 해 두고** 남은 셋을 찍었는데,
 * 그러면 카드 id 목록이 도구 안에 박혀 카드가 하나 늘 때마다 조용히 틀려진다.
 * 여기서는 목록을 알지 않는다 — 아래 `cardProbe`가 **뜬 카드를 내려놓고 다시 뽑는다.**
 *
 * 게임 코드는 건드리지 않는다. `window.__frameProbe`(이미 열려 있는 창)로
 * 매 프레임 판을 들여다보고 붙들어 둘 뿐이다.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.mjs';
import { acquireBrowserLock, LOCK_BUSY_EXIT } from './lib/lock.mjs';
import { startMatch } from './lib/start.mjs';

const PORT = 4189;
const OUT = 'shots';

/**
 * 찍는 화면. **모바일이 먼저다**(DESIGN: 모든 판단 기준은 중급 스마트폰이다) —
 * 카드 셋이 가로 844px에 나란히 서는지는 여기서만 보인다.
 */
const SCREENS = {
  mobile: { width: 844, height: 390, touch: true },
  desktop: { width: 1280, height: 720, touch: false },
};

/** 한 프레임에 되뽑는 횟수의 상한. n장 중 셋을 뽑으므로 기댓값은 n/3번쯤이다. */
const REROLLS = 60;
/** 카드가 뜰 때까지 판을 밀어 주는 스텝 수의 상한(한 프레임에). 60스텝 = 판 1초. */
const PUSHES = 600;

const argv = process.argv.slice(2);
const wantedScreens = Object.keys(SCREENS).filter((name) => argv.includes(name));
const screens = wantedScreens.length > 0 ? wantedScreens : Object.keys(SCREENS);
/** 나머지 인자가 곧 카드 id다. **도구는 어떤 카드가 있는지 알지 않는다**(위 머리말). */
const ids = argv.filter((a) => !Object.keys(SCREENS).includes(a));

if (ids.length === 0) {
  console.error('찍을 카드를 적어라 — 예: npm run shot:card -- repel');
  console.error('카드 id는 `src/data/upgrades.ts`에 있다.');
  process.exit(2);
}

/**
 * 바라는 카드가 낀 3중 1택 화면을 만들어 그 자리에 판을 세운다.
 *
 * **두 가지를 한다.**
 * 1. 카드가 안 떠 있으면 판을 밀어 레벨을 올린다 — 코어를 주우러 걸어가는 사람으로
 *    민다(`tests/support/match.ts`의 `walkToNearestCore`와 같은 규칙). 시계만 밀면
 *    경험치가 들어오지 않아 카드는 영영 안 뜬다.
 * 2. 뜬 셋에 그 카드가 없으면 **내려놓고 다시 뽑는다**(`world.offer = null` 뒤 한 스텝).
 *    `pendingLevelUps`는 그대로라 스텝 끝에서 `openOffer`가 다시 뽑고, 난수는 이어지므로
 *    매번 다른 셋이 나온다. **고르지 않는다** — 넘기려고 한 장을 고르면 능력치가 변하고
 *    눈금(`up-card__pips`)이 붙어, 처음 보는 카드의 화면이 아니게 된다.
 *
 * **찍는 사람은 다쳐 있다**(`WOUNDED`). 체력이 가득 차면 회복 카드가 후보에서 빠져
 * (`World.openOffer`) 그 카드만 영영 못 찍기 때문이다. 밀면서 죽지도 않아야 하므로
 * 매 스텝 같은 값으로 되채운다 — 쓰러지면 화면이 결과 화면으로 바뀐다.
 */
function cardProbe({ id, rerolls, pushes }) {
  const WOUNDED = 0.55;
  const DT = 1 / 60;
  const IDLE = { move: { x: 0, y: 0 }, aim: null };

  /** 가장 가까운 코어로 걸어가는 사람. 브라우저 안이라 그 파일을 못 쓰고 규칙만 옮겨 적었다. */
  function walkToNearestCore(world) {
    let best = null;
    let bestDist = Infinity;
    for (const core of world.cores) {
      if (!core.alive) continue;
      const d = Math.hypot(core.pos.x - world.player.pos.x, core.pos.y - world.player.pos.y);
      if (d < bestDist) {
        bestDist = d;
        best = core;
      }
    }
    if (!best || bestDist < 1e-6) return IDLE;
    return {
      move: {
        x: (best.pos.x - world.player.pos.x) / bestDist,
        y: (best.pos.y - world.player.pos.y) / bestDist,
      },
      aim: null,
    };
  }

  return (world) => {
    // **판은 갈아 끼워진다.** 아레나를 고르면 그 순간 새 World가 들어선다
    // (`main.ts`의 MapSelect) — 고르는 화면 뒤에 비치던 판은 미리 보기였을 뿐이다.
    // 도구는 창이 열린 첫 프레임부터 도므로, 이것을 안 보면 **미리 보기 판에 카드를
    // 세워 놓고 "세웠다"고 적은 뒤 진짜 판에서는 아무것도 하지 않는다**
    // (실제로 그렇게 한 번 찍혔다 — 화면에는 카드가 없고 도구만 다 됐다고 말했다).
    // 다시 시작(`onRestart`)도 같은 길이라 함께 걸린다.
    if (window.__cardWorld !== world) {
      window.__cardWorld = world;
      window.__card = null;
      window.__cardSeen = [];
    }
    const seen = window.__cardSeen ?? (window.__cardSeen = []);
    const report = (ready, offer, extra) => {
      window.__card = {
        ready,
        id,
        level: world.progress.level,
        elapsed: world.elapsed,
        shown: offer ? offer.choices.map((c) => ({ id: c.card.id, title: c.card.title })) : [],
        seen,
        ...extra,
      };
    };
    // 자리를 잡았으면 아무것도 하지 않는다. 판은 카드가 떠 있는 동안 멈춰 있다.
    if (window.__card?.ready) return;

    const note = (offer) => {
      for (const c of offer.choices) if (!seen.includes(c.card.id)) seen.push(c.card.id);
    };

    world.player.hp = world.player.maxHp * WOUNDED;
    for (let i = 0; i < pushes && !world.offer && !world.defeated; i += 1) {
      world.player.hp = world.player.maxHp * WOUNDED;
      world.step(walkToNearestCore(world), DT);
    }
    if (!world.offer) return report(false, null, { reason: '카드가 아직 안 떴다' });

    for (let i = 0; i < rerolls; i += 1) {
      note(world.offer);
      if (world.offer.choices.some((c) => c.card.id === id)) return report(true, world.offer, {});
      // 내려놓고 한 스텝 — 스텝 끝에서 다시 뽑힌다(`World.step`의 마지막 줄).
      world.offer = null;
      world.player.hp = world.player.maxHp * WOUNDED;
      world.step(IDLE, DT);
      if (!world.offer) return report(false, null, { reason: '되뽑는 사이에 판이 끝났다' });
    }
    report(false, world.offer, { reason: `${rerolls}번을 다시 뽑아도 그 카드가 안 나왔다` });
  };
}

// 브라우저 도구는 한 번에 하나만 돈다(`lib/lock.mjs` 머리말).
try {
  acquireBrowserLock('npm run shot:card (card-shot.mjs)');
} catch (error) {
  console.error(error.message);
  process.exit(LOCK_BUSY_EXIT);
}

const preview = await startPreview(PORT);
const browser = await chromium.launch();
let failed = false;

try {
  await mkdir(OUT, { recursive: true });
  for (const id of ids) {
    for (const screen of screens) {
      const { width, height, touch } = SCREENS[screen];
      const label = `${id}/${screen}`;
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 2,
        hasTouch: touch,
        isMobile: touch,
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        failed = true;
        console.error(`  [콘솔 에러] ${label}: ${message.text()}`);
      });
      await page.addInitScript(
        ([source, arg]) => {
          window.__frameProbe = new Function('arg', `return (${source})(arg)`)(arg);
        },
        [cardProbe.toString(), { id, rerolls: REROLLS, pushes: PUSHES }],
      );
      await page.goto(preview.url, { waitUntil: 'load' });
      await startMatch(page);

      const found = await page
        .waitForFunction(() => window.__card?.ready === true, undefined, { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      const seen = await page.evaluate(() => window.__card);
      if (!found) {
        failed = true;
        console.error(`  [못 세웠다] ${label}: ${seen?.reason ?? '판이 열리지 않았다'}`);
        // 되뽑는 동안 실제로 본 카드들을 그대로 보여 준다 — id를 잘못 적었으면 여기서 보인다.
        if (seen?.seen?.length) console.error(`  본 카드: ${seen.seen.join(' · ')}`);
        await page.close();
        continue;
      }

      // 카드가 뜬 뒤 한 장씩 늦게 나타난다(`UpgradeCards`의 55ms 간격). 다 선 뒤에 찍는다.
      // **못 뜨면 던지지 않고 적는다** — 판은 카드를 들고 있는데 화면이 안 그린 것이므로,
      // 그 화면을 찍어 두어야 다음 사람이 무엇이 어긋났는지 볼 수 있다.
      const shown = await page
        .waitForSelector('#upgrade[data-show="1"]', { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!shown) {
        failed = true;
        console.error(`  [안 뜬 화면] ${label}: 판은 카드를 들고 있는데 화면에 안 떴다`);
      }
      await page.waitForTimeout(700);

      // **화면에 뜬 것과 판이 들고 있는 것이 같은가.** 다르면 찍은 장이 거짓말을 한다 —
      // 도구는 "세웠다"고 적는데 화면에는 다른 셋이 서 있는 경우다(카드 화면은 판과
      // 프레임이 어긋날 수 있는 유일한 화면이다 — `cards.sync`가 프레임 끝에서 돈다).
      const drawn = await page.evaluate(() =>
        [...document.querySelectorAll('.up-card__title')].map((el) => el.textContent),
      );
      const titles = seen.shown.map((c) => c.title);
      if (drawn.join('|') !== titles.join('|')) {
        failed = true;
        console.error(`  [어긋난 화면] ${label}: 화면은 [${drawn.join(' · ')}] · 판은 [${titles.join(' · ')}]`);
      }

      // **설명이 한 줄에 들어오는가.** 나머지가 전부 한 줄인데 한 장만 접히면 그 장만
      // 마지막 낱말이 홀로 떨어져, 카드 셋을 나란히 놓았을 때 한 장이 덜 다듬어져 보인다.
      // 세션 58이 뒷걸음에서 겪었다 — 처음 쓴 글이 모바일(844px)에서 두 줄이 됐고,
      // 눈으로 보기 전에는 아무도 몰랐다. 폭은 글자 수로 못 센다(한글·숫자·공백의 너비가
      // 다 다르다. 실제로 더 짧아 보이는 글이 먼저 접혔다). **브라우저가 이미 아는 값이므로
      // 여기서 묻는다** — 이 도구는 카드를 넣는 바퀴가 반드시 돌리는 자리다.
      const wrapped = await page.evaluate(() =>
        [...document.querySelectorAll('.up-card')]
          .map((card) => {
            const detail = card.querySelector('.up-card__detail');
            if (!detail) return null;
            const lineHeight = parseFloat(getComputedStyle(detail).lineHeight);
            return {
              title: card.querySelector('.up-card__title')?.textContent ?? '',
              text: detail.textContent ?? '',
              lines: Math.round(detail.getBoundingClientRect().height / lineHeight),
            };
          })
          .filter((c) => c && c.lines > 1),
      );
      for (const c of wrapped) {
        failed = true;
        console.error(`  [두 줄로 접혔다] ${label}: ${c.title} — "${c.text}" (${c.lines}줄)`);
      }

      const path = `${OUT}/card-${id}-${screen}.png`;
      await page.screenshot({ path });
      console.log(`  ${path}`);
      console.log(
        `  Lv${seen.level} · ${Math.round(seen.elapsed)}초 · [${drawn.join(' · ')}]`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
  await preview.stop();
}

if (failed) {
  console.error('찍은 화면에 문제가 있다. 위에 찍힌 [ ] 표시를 보라.');
  process.exit(1);
}
