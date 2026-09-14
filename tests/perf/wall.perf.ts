/**
 * **벽을 등지고 서면 왜 오래 사는가** — 세션 48이 기둥 그늘을 닫고 나서 남은 자리다.
 *
 * 기둥이 하나도 없는 빈 뜰에서도 벽 앞 한 자리에 손을 놓고 서면 **120초**를 버틴다
 * (한복판 40초). 가림 때문이 아니다 — 그 자리의 **피격률은 오히려 더 높다**(0.717 대 0.588).
 * 갈리는 것은 **날아오는 화살의 수**다(초당 0.25 대 0.87). 벽을 등지면 적이 반쪽에서만
 * 오고, 손을 놓고 있어도 자동 발사가 그 좁은 앞을 먼저 쓸어 버린다(처치 76 대 16).
 *
 * 그래서 이 자는 **버틴 시간과 피격률과 날아온 수를 함께** 찍는다. 셋을 같이 보지 않으면
 * "오래 살았다"가 숨은 것인지 이긴 것인지 갈리지 않는다.
 *
 * **자리가 1cm만 달라도 값이 튄다**(r24·30도 120초 · 36도 78초 · r20·30도 35초).
 * 그러니 여기 나온 시간에 검사의 선을 그으면 안 된다 — `tests/maps.test.ts`가
 * 시간이 아니라 피격률에 선을 그어 둔 이유다.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/wall.perf.ts
 */
import { describe, it } from 'vitest';
import { World } from '../../src/core/World';
import { MAPS } from '../../src/data/maps';
import { IDLE, median, play } from '../support/match';

const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);
const SPOTS = [
  { name: '한복판', x: 0, y: 0 },
  { name: '벽 앞(r24·30도)', x: Math.cos(Math.PI / 6) * 24, y: Math.sin(Math.PI / 6) * 24 },
  { name: '벽 앞(r24·36도)', x: Math.cos(Math.PI / 5) * 24, y: Math.sin(Math.PI / 5) * 24 },
  { name: '벽 앞(r20·30도)', x: Math.cos(Math.PI / 6) * 20, y: Math.sin(Math.PI / 6) * 20 },
];

describe('벽 앞', () => {
  it('빈 뜰에서 자리마다', () => {
    const map = MAPS[0]!;
    for (const at of SPOTS) {
      const rows = SEEDS.map((seed) => {
        const world = new World({ seed, map });
        world.player.pos = { x: at.x, y: at.y };
        play(world, 60 * 300, () => IDLE);
        return {
          t: world.elapsed,
          rate: world.enemyShots > 0 ? world.arrowHits / world.enemyShots : 1,
          perSec: world.enemyShots / world.elapsed,
          kills: world.kills,
        };
      });
      console.log(
        `${at.name}: ${median(rows.map((r) => r.t)).toFixed(0)}초 · ` +
          `피격률 ${median(rows.map((r) => r.rate)).toFixed(3)} · ` +
          `날아온 화살 초당 ${median(rows.map((r) => r.perSec)).toFixed(2)} · ` +
          `처치 ${median(rows.map((r) => r.kills)).toFixed(0)}`,
      );
    }
  });
});
