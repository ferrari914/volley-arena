/**
 * 적을 눈으로 보려고 만든 도구다. 두 가지를 찍는다.
 *
 *   npm run shot:enemy                      # 세 종류를 한 마리씩 가까이서
 *   npm run shot:enemy -- shield calm worn flash aim
 *   npm run shot:enemy -- crowd             # 적이 상한(15마리)까지 찬 화면
 *   npm run shot:enemy -- crowd 13
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
/** 창을 열고 찍기까지의 시간(ms). 목표 수가 달라도 이 나이는 같게 둔다(아래 주석). */
const SETTLE_MS = 15000;

const argv = process.argv.slice(2);
const crowd = argv.includes('crowd');
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
 * 적이 목표 수만큼 설 때까지 **시계만 앞으로 민다**. 적을 직접 만들어 세우지 않는 이유:
 * 증원이 어디에 서고 무엇이 오는지는 `REINFORCE.order`와 `pickReinforceSpawn`이 정하는데,
 * 도구가 그것을 흉내 내면 표를 고친 날 화면이 조용히 거짓말을 하게 된다.
 * 시계를 밀면 게임이 자기 규칙대로 부른다 — 그래서 이 화면은 실제로 오래 버틴 사람의 화면이다.
 *
 * **한 프레임에 4초씩 민다.** 증원 간격(32초)보다 짧아야 한 프레임에 여러 마리가
 * 한꺼번에 튀어나오지 않고, 다 채운 뒤 HUD에 남는 시각도 실제 그 시각에서 4초 안쪽이다
 * (열다섯째는 408초에 온다). 상한에 닿아 더 안 늘면 시계도 멈춘다 —
 * 안 그러면 화면의 시각만 끝없이 올라간다.
 */
function crowdProbe({ count }) {
  return (world) => {
    // 카드가 뜨면 판이 멈춘다(그동안 시계도 안 간다). 첫 장을 골라 계속 굴린다 —
    // 여기까지 온 사람이 카드를 안 골랐을 리 없다.
    if (world.offer) world.chooseUpgrade(world.offer.choices[0].card.id);
    if (world.enemies.length < count && world.elapsed < 900) world.elapsed += 4;
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
    window.__crowd = {
      total: world.enemies.length,
      alive: alive.length,
      near,
      elapsed: world.elapsed,
      level: world.progress.level,
      arrows: world.arrows.length,
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
    const label = `crowd-${crowdCount}`;
    const openedAt = Date.now();
    const page = await openPage(label, crowdProbe.toString(), { count: crowdCount }, countDrawCalls);
    // 다 서기까지: 4초씩 미니 열 마리에 100프레임 남짓이다.
    await page.waitForFunction(
      (count) => (window.__crowd?.total ?? 0) >= count,
      crowdCount,
      { timeout: 20000 },
    );
    // 선 것과 화면에 든 것은 다르다. 증원은 22m 밖에서 걸어 들어온다(활잡이 3.4m/s).
    // 열넷째까지 14m 안에 들면 찍는다 — 하나쯤은 늘 쓰러져 다시 서는 중이라
    // 전원을 기다리면 영영 안 찍힌다.
    await page
      .waitForFunction(
        (count) => (window.__crowd?.near ?? 0) >= count - 1,
        crowdCount,
        { timeout: 20000 },
      )
      .catch(() => console.warn('  (다 모이기 전에 찍는다 — 아래 수를 보고 판단할 것)'));
    // **어느 장이든 창을 연 지 같은 시간 뒤에 찍는다.** fps 표시는 지수 이동 평균이라
    // (`Ticker`의 0.1) 0에서 올라오는 데 시간이 걸리고, 무리를 채우는 데 걸리는 시간은
    // 목표 수마다 다르다. 그냥 찍으면 **적이 적은 화면일수록 fps가 낮게 찍힌다** —
    // 일찍 찍히기 때문이다(적 5마리를 2초에 찍으니 14fps, 열다섯을 7초에 찍으니 24fps였다).
    // 두 장을 나란히 놓고 견주려면 나이가 같아야 한다.
    await page.waitForTimeout(Math.max(0, openedAt + SETTLE_MS - Date.now()));
    const path = `${OUT}/${label}.png`;
    await page.screenshot({ path });
    const seen = await page.evaluate(() => window.__crowd);
    console.log(`  ${path}`);
    console.log(
      `  적 ${seen.alive}/${seen.total}마리(14m 안 ${seen.near}) · ` +
        `${Math.round(seen.elapsed)}초 · Lv${seen.level} · 화살 ${seen.arrows} · ` +
        `드로우콜 ${seen.drawCalls}`,
    );
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
