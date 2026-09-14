/**
 * **활잡이의 시간이 어디로 가는가** — 자리에 따라 판이 갈리는 이유를 한 줄로 보는 자.
 *
 * "여기 서면 오래 산다"를 시간으로만 재면 무엇이 움직였는지 알 수 없다. 여기서는 살아 있는
 * 활잡이 한 마리 한 마리가 매 프레임 무엇을 하고 있었는지를 다섯으로 갈라 센다 —
 * 죽어 있음 · 사거리 밖 · 가려 있음 · 쿨다운 대기 · 겨눔.
 *
 * 세션 49가 이걸로 벽 앞 요새의 정체를 잡았다. 벽을 등지고 선 사람 앞에서는
 * **사거리 밖에서 보낸 몫이 한복판의 네 배**였다(0.09 대 0.32~0.47) — 적이 가려서가 아니라
 * **걷느라 싸우지 못한 것**이다. 다시 설 자리를 플레이어 둘레 고리로 옮긴 뒤 같은 자로 재면
 * 0.085 대 0.165~0.243이다.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/diag.perf.ts
 */
import { describe, it } from 'vitest';
import { World } from '../../src/core/World';
import { MAPS } from '../../src/data/maps';
import { IDLE, play } from '../support/match';
import { ENEMY, SHIELD } from '../../src/data/config';
import { sightBlocker } from '../../src/systems/obstacles';

const SEEDS = Array.from({ length: 8 }, (_, i) => 20260909 + i);
const SPOTS = [
  { map: 0, name: '빈 뜰 한복판', r: 0, deg: 0 },
  { map: 0, name: '빈 뜰 r24·30', r: 24, deg: 30 },
  { map: 1, name: '기둥 한복판', r: 0, deg: 0 },
  { map: 1, name: '기둥 r20·60', r: 20, deg: 60 },
  { map: 1, name: '기둥 r22·330', r: 22, deg: 330 },
];

describe('활잡이의 시간', () => {
  it('자리마다 어디로 가는가', () => {
    for (const spot of SPOTS) {
      const map = MAPS[spot.map]!;
      const a = (spot.deg * Math.PI) / 180;
      const at = { x: Math.cos(a) * spot.r, y: Math.sin(a) * spot.r };
      const bucket = { dead: 0, far: 0, blocked: 0, wait: 0, aim: 0 };
      let secs = 0;
      let shots = 0;
      for (const seed of SEEDS) {
        const world = new World({ seed, map });
        world.player.pos = { x: at.x, y: at.y };
        let t = 0;
        while (!world.defeated && t < 60 * 200) {
          play(world, 1, () => IDLE);
          t += 1;
          for (const e of world.enemies) {
            if (e.kind === 'charger') continue;
            const range = e.kind === 'shield' ? SHIELD.fireRange : ENEMY.fireRange;
            if (!e.alive) { bucket.dead += 1; continue; }
            const d = Math.hypot(e.pos.x - world.player.pos.x, e.pos.y - world.player.pos.y);
            if (e.aimTimer > 0) bucket.aim += 1;
            else if (d > range) bucket.far += 1;
            else if (sightBlocker(e.pos, world.player.pos, 0.16 + d * ENEMY.spread, map.obstacles)) bucket.blocked += 1;
            else bucket.wait += 1;
          }
        }
        secs += world.elapsed;
        shots += world.enemyShots;
      }
      const total = bucket.dead + bucket.far + bucket.blocked + bucket.wait + bucket.aim;
      const p = (n: number) => (n / total).toFixed(3);
      console.log(
        `${spot.name}: 판 ${(secs / SEEDS.length).toFixed(0)}초 · 초당 ${(shots / secs).toFixed(2)}발 | ` +
          `죽어있음 ${p(bucket.dead)} · 사거리밖 ${p(bucket.far)} · 가림 ${p(bucket.blocked)} · 쿨다운 ${p(bucket.wait)} · 겨눔 ${p(bucket.aim)}`,
      );
    }
  });
});
