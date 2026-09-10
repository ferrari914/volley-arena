/**
 * 적 하나를 가까이서 찍는다 — 눈으로 보려고 만든 도구다.
 *
 *   npm run shot:enemy              # 세 종류를 있는 그대로
 *   npm run shot:enemy -- shield calm worn flash aim
 *
 * **왜 `npm run qa`로는 안 되는가**: qa는 판을 처음부터 돌려 화면 흐름을 잰다.
 * 그 판에서 특정 적이 화면에 잡히는지는 운이고(방패병은 22m 밖에 서 있다),
 * "방패가 닳았을 때"·"받아 낸 순간"처럼 **잠깐 스치는 상태**는 사실상 못 찍는다.
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

const argv = process.argv.slice(2);
const kind = argv.find((a) => ['archer', 'charger', 'shield'].includes(a));
const states = argv.filter((a) => STATES.includes(a));
const kinds = kind ? [kind] : ['archer', 'charger', 'shield'];
const wanted = states.length > 0 ? states : ['live'];

/**
 * 적 앞 5.5m에 플레이어를 붙들어 둔다. 카메라는 플레이어를 따라오므로
 * 이 한 줄이 곧 "그 적을 가까이서 본다"가 된다. 적의 정면이 카메라를 향하도록
 * **적보다 카메라 쪽(+y)에** 세운다.
 */
function probe(kind, state) {
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

const preview = await startPreview(PORT);
const browser = await chromium.launch();
let failed = false;
try {
  await mkdir(OUT, { recursive: true });
  for (const kind of kinds) {
    for (const state of wanted) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        failed = true;
        console.error(`  [콘솔 에러] ${kind}/${state}: ${message.text()}`);
      });
      await page.addInitScript(
        ([kind, state, source]) => {
          window.__frameProbe = new Function('kind', 'state', `return (${source})(kind, state)`)(
            kind,
            state,
          );
        },
        [kind, state, probe.toString()],
      );
      await page.goto(preview.url, { waitUntil: 'load' });
      // 방패가 오르내리는 데 걸리는 시간(`SHIELD_RAISE_RATE`)보다 넉넉히 기다린다.
      await page.waitForTimeout(2600);
      const path = `${OUT}/enemy-${kind}-${state}.png`;
      await page.screenshot({ path });
      console.log(`  ${path}`);
      await page.close();
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
