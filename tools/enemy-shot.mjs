/**
 * 적을 눈으로 보려고 만든 도구다. 두 가지를 찍는다.
 *
 *   npm run shot:enemy                      # 세 종류를 한 마리씩 가까이서
 *   npm run shot:enemy -- shield calm worn flash aim
 *   npm run shot:enemy -- crowd             # 적이 상한(15마리)까지 찬 화면
 *   npm run shot:enemy -- crowd 13
 *   npm run shot:enemy -- crowd veteran     # 그 자리까지 실제로 싸워 올라간 사람의 화면
 *
 * **왜 `npm run qa`로는 안 되는가**: qa는 판을 처음부터 돌려 화면 흐름을 잰다.
 * 그 판에서 특정 적이 화면에 잡히는지는 운이고(방패병은 22m 밖에 서 있다),
 * "방패가 닳았을 때"·"받아 낸 순간"처럼 **잠깐 스치는 상태**는 사실상 못 찍는다.
 * 무엇보다 qa가 찍는 전투 화면은 0:14의 판이라 **증원이 한 마리도 없다** —
 * 증원은 120초부터 들어오므로, 상한까지 찬 화면은 qa로는 영영 안 찍힌다.
 * 그래서 판을 흔들지 않고 카메라만 들이대는 도구를 따로 둔다.
 *
 * **왜 파일로 두는가**: 세션 21과 22가 이것과 같은 임시 하네스를 각각 새로 짜고
 * 지웠다. 짜서 지우면 다음 세션이 같은 화면을 다시 만들지 못하고, 무엇보다
 * 지난 세션이 무엇을 보고 판단했는지 재현할 수 없다
 * (밸런스 하네스에서 이미 한 번 겪은 일이다 — STATUS.md 세션 20).
 *
 * 게임 코드는 건드리지 않는다. `window.__frameProbe`(입력 지연 측정용으로 이미
 * 열려 있는 창)로 매 프레임 판을 들여다보고 붙들어 둘 뿐이다.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.mjs';

const PORT = 4187;
const OUT = 'shots';

/** 붙들 수 있는 상태들. 종류마다 해당 없는 것은 조용히 지나간다. */
const STATES = ['live', 'calm', 'aim', 'worn', 'flash'];
/** 무리 화면의 기본 목표 수. `REINFORCE`의 상한(5 + maxExtra)과 같은 값이다. */
const CROWD_DEFAULT = 15;
/**
 * **다 모인 뒤 찍기까지 기다리는 시간(ms).** 창을 연 시각이 아니라 화면이 제 모양을 갖춘
 * 시각에서 잰다 — 다 채우는 데 걸리는 시간은 목표 수마다 다르고, `veteran`은 판을 실제로
 * 돌리느라 20초 넘게 걸린다(자세한 이유는 아래 기다림 옆에 적어 두었다).
 */
const SETTLE_MS = 15000;

const argv = process.argv.slice(2);
const crowd = argv.includes('crowd');
/** 무리 화면을 **실제로 싸워 올라간 사람**으로 찍는가(위 `crowdProbe` 머리말). */
const veteran = argv.includes('veteran');
const kind = argv.find((a) => ['archer', 'charger', 'shield'].includes(a));
const states = argv.filter((a) => STATES.includes(a));
const kinds = kind ? [kind] : ['archer', 'charger', 'shield'];
const wanted = states.length > 0 ? states : ['live'];
const crowdCount = Number(argv.find((a) => /^\d+$/.test(a)) ?? CROWD_DEFAULT);

/**
 * 적 앞 5.5m에 플레이어를 붙들어 둔다. 카메라는 플레이어를 따라오므로
 * 이 한 줄이 곧 "그 적을 가까이서 본다"가 된다. 적의 정면이 카메라를 향하도록
 * **적보다 카메라 쪽(+y)에** 세운다.
 */
function closeUpProbe({ kind, state }) {
  return (world) => {
    const target = world.enemies.find((e) => e.kind === kind && e.alive);
    if (!target) return;
    world.player.pos.x = target.pos.x;
    world.player.pos.y = target.pos.y + 5.5;
    // 판이 끝나 버리면 화면이 결과 화면으로 바뀐다. 찍는 동안에는 죽지 않는다.
    world.player.hp = world.player.maxHp;
    target.hp = target.maxHp;

    if (state === 'calm' || state === 'worn') world.arrows.length = 0;
    if (state === 'calm') target.shieldFlash = 0;
    if (state === 'aim') target.aimTimer = 0.4;
    if (state === 'worn') {
      target.shieldHp = 1;
      target.shieldFlash = 0;
    }
    if (state === 'flash') {
      world.arrows.length = 0;
      target.shieldFlash = 1;
    }
  };
}

/**
 * 적이 목표 수만큼 설 때까지 판을 앞으로 민다. 적을 직접 만들어 세우지 않는 이유:
 * 증원이 어디에 서고 무엇이 오는지는 `REINFORCE.order`와 `pickReinforceSpawn`이 정하는데,
 * 도구가 그것을 흉내 내면 표를 고친 날 화면이 조용히 거짓말을 하게 된다.
 * 판을 밀면 게임이 자기 규칙대로 부른다 — 그래서 이 화면은 실제로 오래 버틴 사람의 화면이다.
 *
 * **미는 방법이 둘이다. 무엇을 보려느냐로 갈린다.**
 *
 * - 기본(`crowd`): **시계만 민다**(`world.elapsed += AHEAD`). 판은 실시간 그대로 돌아가므로
 *   화면에 서는 것은 **Lv1이 상대하는 열다섯**이다. 적 쪽 값(드로우콜·뭉침)을 볼 때 쓴다.
 *   싸게 밀 수 있고, 사람 쪽이 자라지 않으니 적 수 말고는 달라지는 것이 없다.
 * - `veteran`: **판을 실제로 돌린다**(`world.step`을 한 프레임에 여러 번). 코어를 주우러 걷고
 *   카드를 고르고 적을 잡는 것이 전부 게임 안에서 실제로 일어나므로, 그 자리에 닿았을 때의
 *   레벨·화력·살아 있는 화살 수가 **진짜 그 판의 값**이다. 화살 쪽 렌더 비용은 이쪽으로만 볼 수 있다 —
 *   시계만 밀면 화살은 영영 대여섯 발이다(STATUS 세션 26의 '렌더 비용' 항목).
 *
 * 한 프레임에 미는 양(`AHEAD`)은 두 쪽이 다르다 — 그 자리의 주석을 보라.
 * 상한에 닿아 더 안 늘면 미는 것도 멈춘다. 안 그러면 화면의 시각만 끝없이 올라가고,
 * `veteran`은 fps 표시까지 흐려진다(미는 동안에는 한 프레임이 천 스텝을 돈다.
 * 다 채운 뒤 `SETTLE_MS`만큼 가만히 두어야 프레임이 제 무게로 돌아온다).
 */
function crowdProbe({ count, veteran }) {
  /**
   * 한 프레임에 밀어 주는 판 시간(s).
   *
   * **시계를 미는 쪽은 4초여야 한다** — 증원 간격(32초)보다 짧아야 한 프레임에 여러 마리가
   * 한꺼번에 튀어나오지 않는다. **판을 실제로 돌리는 쪽은 그럴 이유가 없다**: 그 안에서
   * 한 스텝씩 다 도므로 증원도 제 시각에 하나씩 온다. 그래서 크게 잡는다 —
   * 여기서 아끼는 것은 그리는 시간이다(400초를 4초씩 밀면 백 프레임을 그린다).
   */
  const AHEAD = veteran ? 20 : 4;
  /** 게임 루프와 같은 60fps. `Ticker`의 고정 간격이다. */
  const DT = 1 / 60;

  /**
   * 가장 가까운 코어로 걸어가는 사람. `tests/support/match.ts`의 `walkToNearestCore`와 같은 규칙이고,
   * **밸런스를 재는 자와 같은 사람이어야 화면의 레벨을 그 표와 견줄 수 있다.**
   * (브라우저 안에서 도는 코드라 그 파일을 가져다 쓸 수 없어 규칙만 옮겨 적었다.)
   */
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
    if (!best || bestDist < 1e-6) return { move: { x: 0, y: 0 }, aim: null };
    return {
      move: {
        x: (best.pos.x - world.player.pos.x) / bestDist,
        y: (best.pos.y - world.player.pos.y) / bestDist,
      },
      aim: null,
    };
  }

  /** 아직 더 밀어야 하는가. 상한에 닿았거나 판이 너무 길어지면 멈춘다. */
  function filling(world) {
    return world.enemies.length < count && world.elapsed < 900 && !world.defeated;
  }

  return (world) => {
    if (veteran) {
      // **화력만 고르는 사람이다**(`preferPower`). 화살 쪽 렌더 비용의 상한을 보려는 화면이므로,
      // 화살이 가장 많아지는 쪽을 세운다 — 다중 발사·관통·튕김이 전부 화력 카드다.
      const steps = Math.round(AHEAD / DT);
      for (let i = 0; i < steps && filling(world); i += 1) {
        const offer = world.offer;
        if (offer) {
          const pick = offer.choices.find((c) => c.card.role === 'power') ?? offer.choices[0];
          // 못 고르면 판이 멈춘 채로 남는다. 여기서 접어야 바깥의 기다림이 이유를 보고 끝난다.
          if (!pick || !world.chooseUpgrade(pick.card.id)) break;
        }
        // 미는 동안에는 죽지 않는다(아래와 같은 이유). 스텝 안에서 체력이 다하면 판이 끝나므로
        // 돌리기 **전에** 채운다.
        world.player.hp = world.player.maxHp;
        world.step(walkToNearestCore(world), DT);
      }
    } else {
      // 카드가 뜨면 판이 멈춘다(그동안 시계도 안 간다). 첫 장을 골라 계속 굴린다 —
      // 여기까지 온 사람이 카드를 안 골랐을 리 없다.
      if (world.offer) world.chooseUpgrade(world.offer.choices[0].card.id);
      if (filling(world)) world.elapsed += AHEAD;
    }
    // 찍는 동안에는 죽지 않는다. 열다섯을 상대로 이 판의 화력은 몇 초를 못 버틴다 —
    // 쓰러지면 화면이 결과 화면으로 바뀌어 아무것도 못 본다.
    world.player.hp = world.player.maxHp;

    const alive = world.enemies.filter((e) => e.alive);
    let near = 0;
    for (const e of alive) {
      const dx = e.pos.x - world.player.pos.x;
      const dy = e.pos.y - world.player.pos.y;
      if (Math.hypot(dx, dy) <= 14) near += 1;
    }
    // **한 프레임의 값만으로는 화살 쪽 비용을 읽을 수 없다.** 살아 있는 화살 수가 프레임마다
    // 크게 흔들리기 때문이다 — 화살은 수명이 다해서도 죽지만 적에게 꽂혀서도 죽는다.
    // 적이 코앞에 몰려 있으면 나가자마자 사라지고(실측 11발), 적이 멀면 다 날아가는 동안
    // 쌓인다(같은 판에서 33발). 그래서 가장 많았던 프레임을 따로 붙잡아 둔다.
    const peak = window.__crowdPeak ?? { arrows: 0, drawCalls: 0 };
    peak.arrows = Math.max(peak.arrows, world.arrows.length);
    peak.drawCalls = Math.max(peak.drawCalls, window.__drawCalls ?? 0);
    window.__crowdPeak = peak;

    window.__crowd = {
      total: world.enemies.length,
      alive: alive.length,
      near,
      elapsed: world.elapsed,
      level: world.progress.level,
      arrows: world.arrows.length,
      // 바닥의 코어도 하나에 한 콜씩이다(세션 26). 잘 하는 사람일수록 드롭이 쌓여
      // **화살보다 코어가 더 많은 프레임**이 나온다 — 화살 쪽 값을 읽으려면 이 수를 함께 봐야 한다.
      cores: world.cores.length,
      peakArrows: peak.arrows,
      peakDrawCalls: peak.drawCalls,
      // 화살 쪽 렌더 비용을 읽으려면 화살이 몇 발씩 나가는지를 함께 봐야 한다.
      shot: {
        count: world.stats.arrowCount,
        pierce: world.stats.pierce,
        bounce: world.stats.bounce,
        cooldown: world.stats.fireCooldown,
      },
      cards: world.takenUpgrades.length,
      // 이 프레임이 실제로 부른 드로우콜. 아래 `countDrawCalls`가 세고 여기서 비운다.
      drawCalls: window.__drawCalls ?? 0,
    };
    window.__drawCalls = 0;
  };
}

/**
 * WebGL 드로우콜을 프레임마다 센다. **게임 코드가 아니라 브라우저 쪽에 손을 댄다** —
 * 렌더러를 창밖으로 내보내려면 `main.ts`를 고쳐야 하고, 그러면 도구를 위해 게임이
 * 바뀐다. 여기서 세면 게임은 자기가 재이고 있는 줄도 모른다.
 */
function countDrawCalls() {
  const protos = [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype];
  const names = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'];
  window.__drawCalls = 0;
  for (const proto of protos) {
    if (!proto) continue;
    for (const name of names) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function (...args) {
        window.__drawCalls += 1;
        return original.apply(this, args);
      };
    }
  }
}

const preview = await startPreview(PORT);
const browser = await chromium.launch();
let failed = false;

/** 콘솔 에러를 잡아 두는 창 하나. 어느 화면에서 났는지 이름과 함께 남긴다. */
async function openPage(label, probeSource, arg, before) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    failed = true;
    console.error(`  [콘솔 에러] ${label}: ${message.text()}`);
  });
  if (before) await page.addInitScript(before);
  await page.addInitScript(
    ([source, arg]) => {
      window.__frameProbe = new Function('arg', `return (${source})(arg)`)(arg);
    },
    [probeSource, arg],
  );
  await page.goto(preview.url, { waitUntil: 'load' });
  return page;
}

try {
  await mkdir(OUT, { recursive: true });
  if (crowd) {
    const label = veteran ? `crowd-${crowdCount}-veteran` : `crowd-${crowdCount}`;
    const openedAt = Date.now();
    if (veteran) console.log('  (판을 실제로 돌려 그 자리까지 간다 — 20초쯤 걸린다)');
    const page = await openPage(
      label,
      crowdProbe.toString(),
      { count: crowdCount, veteran },
      countDrawCalls,
    );
    // 다 서기까지: 4초씩 미니 열 마리에 100프레임 남짓이다.
    // `veteran`은 한 프레임이 240스텝을 도느라 프레임이 무거워져 그만큼 더 걸린다 —
    // 그래도 15초 안에는 끝나야 한다(아래 `SETTLE_MS`가 그 시각에 찍는다).
    await page.waitForFunction(
      (count) => (window.__crowd?.total ?? 0) >= count,
      crowdCount,
      { timeout: 20000 },
    );
    // 선 것과 화면에 든 것은 다르다. 증원은 22m 밖에서 걸어 들어온다(활잡이 3.4m/s).
    // 하나만 빼고 14m 안에 들면 찍는다 — 하나쯤은 늘 쓰러져 다시 서는 중이라
    // 전원을 기다리면 영영 안 찍힌다.
    //
    // **`veteran`은 목표 수가 아니라 서 있는 수에서 센다.** 실제로 싸우는 판에서는
    // 늘 서넛이 쓰러져 다시 서는 중이라(첫 판에 11/15였다) 목표 수로 세면 이 기다림이
    // 영영 안 끝난다. 그러면 20초를 다 쓰고 나서야 찍히는데, 그건 나이를 맞춘 화면이 아니다
    // (`SETTLE_MS` 주석 — 나이가 다르면 fps도 드로우콜도 견줄 수 없다).
    await page
      .waitForFunction(
        ([count, veteran]) => {
          const seen = window.__crowd;
          if (!seen) return false;
          const target = veteran ? Math.max(1, seen.alive - 1) : count - 1;
          return seen.near >= target;
        },
        [crowdCount, veteran],
        { timeout: 20000 },
      )
      .catch(() => console.warn('  (다 모이기 전에 찍는다 — 아래 수를 보고 판단할 것)'));
    // **다 모인 뒤로 같은 시간을 기다렸다가 찍는다.** fps 표시는 지수 이동 평균이라
    // (`Ticker`의 0.1) 화면이 바뀐 뒤 값이 따라오는 데 시간이 걸린다. 그냥 찍으면
    // **적이 적은 화면일수록 fps가 낮게 찍힌다** — 일찍 찍히기 때문이다
    // (적 5마리를 2초에 찍으니 14fps, 열다섯을 7초에 찍으니 24fps였다).
    //
    // **창을 연 시각이 아니라 여기서부터 잰다.** 다 채우는 데 걸리는 시간이 장마다 다르기
    // 때문이다 — 시계만 미는 쪽은 2초, `veteran`은 판을 실제로 돌리느라 20초쯤 걸린다.
    // 창을 연 시각에서 재면 오래 채운 장일수록 **다 모인 화면을 짧게 본 채로** 찍히고,
    // fps는 그 직전의 헐거운 화면(또는 밀어 대느라 무거웠던 프레임)을 아직 기억하고 있다.
    // 견주어야 하는 것은 창의 나이가 아니라 **제 모양을 갖춘 뒤의 나이**다.
    await page.waitForTimeout(SETTLE_MS);
    // 기다리는 동안에도 판은 돈다. 적은 쓰러지고 다시 서고, 사람은 코어를 주우러 걸어간다 —
    // 그래서 이 순간에 무리가 화면에 들어와 있으리라는 보장이 없다(실측: 열다섯 중 둘만 남은 프레임).
    // 무리가 든 프레임을 잠깐 기다렸다가 찍는다. 못 잡으면 그냥 찍고, 아래 수로 판단하게 한다.
    await page
      .waitForFunction(
        () => {
          const seen = window.__crowd;
          return seen ? seen.near >= Math.max(1, seen.alive - 1) : false;
        },
        undefined,
        { timeout: 5000 },
      )
      .catch(() => console.warn('  (무리가 흩어진 프레임에 찍는다 — 아래 수를 보고 판단할 것)'));
    const path = `${OUT}/${label}.png`;
    const age = Date.now() - openedAt;
    await page.screenshot({ path });
    const seen = await page.evaluate(() => window.__crowd);
    console.log(`  ${path} (창을 연 지 ${(age / 1000).toFixed(1)}초)`);
    console.log(
      `  적 ${seen.alive}/${seen.total}마리(14m 안 ${seen.near}) · ` +
        `${Math.round(seen.elapsed)}초 · Lv${seen.level} · 화살 ${seen.arrows} · ` +
        `코어 ${seen.cores} · 드로우콜 ${seen.drawCalls}`,
    );
    console.log(
      `  카드 ${seen.cards}장 · 한 번에 ${seen.shot.count}발 · 관통 ${seen.shot.pierce} · ` +
        `튕김 ${seen.shot.bounce} · 발사 간격 ${seen.shot.cooldown.toFixed(3)}s`,
    );
    console.log(`  가장 많았던 프레임: 화살 ${seen.peakArrows} · 드로우콜 ${seen.peakDrawCalls}`);
    await page.close();
  } else {
    for (const kind of kinds) {
      for (const state of wanted) {
        const page = await openPage(`${kind}/${state}`, closeUpProbe.toString(), { kind, state });
        // 방패가 오르내리는 데 걸리는 시간(`SHIELD_RAISE_RATE`)보다 넉넉히 기다린다.
        await page.waitForTimeout(2600);
        const path = `${OUT}/enemy-${kind}-${state}.png`;
        await page.screenshot({ path });
        console.log(`  ${path}`);
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  preview.stop();
}

if (failed) {
  console.error('콘솔에 에러가 찍혔다.');
  process.exit(1);
}
