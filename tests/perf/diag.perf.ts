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
import { backOffBomber, circleShield, IDLE, play, walkToNearestCore } from '../support/match';
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

/**
 * **적끼리 얼마나 가까운가** — 적이 쓰러지는 그 순간, 가장 가까운 다른 적까지의 거리.
 *
 * 왜 재 두는가: **"적끼리의 거리"를 보는 카드가 이 아레나에서 값을 벌 수 있는지**를
 * 한 줄로 답하는 자다. 세션 60이 그런 카드를 하나 만들었다(파열 — 쓰러진 적이 터져
 * 곁의 적을 깎는다). 만들기는 다 만들었는데, 세션 61이 재 보니 **곁에 아무도 없었다** —
 * 중앙 11.8m다. 카드가 감당할 만한 반지름(2.2m)에 드는 처치는 **0.4%**고,
 * 실제로 240판을 돌려도 터짐 한 번에 0.02명을 깎았다. 그 카드는 되돌렸다
 * (`git revert` 한 줄로 돌아온다 — `docs/STATUS.md` 세션 61).
 *
 * **이 값은 카드가 아니라 아레나가 정한다**: 반지름 25m 안에 적이 다섯이고
 * (`data/maps.ts`의 표준 배치), 저마다 제 자리에서 걸어와 제 사거리에서 선다.
 * 그러니 뭉치는 일이 애초에 없다 — 플레이어에게는 적을 모으는 수단도 없다
 * (밀어내기는 도리어 떼어 놓는다). **적이 떼로 나오게 되기 전까지는
 * 적끼리의 거리를 보는 효과를 만들지 마라.** 만들려면 여기부터 다시 재라.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/diag.perf.ts
 */
describe('적끼리의 거리', () => {
  /** 걷는 사람과 도는 사람. 둘 다 적을 제 둘레로 끌어모으는 쪽인데도 값이 같다. */
  const WALKERS = [
    { name: '걷는 사람', input: walkToNearestCore },
    { name: '도는 사람', input: backOffBomber(circleShield) },
  ] as const;

  it('쓰러지는 순간 곁에 누가 있었는가', () => {
    for (const walker of WALKERS) {
      const gaps: number[] = [];
      for (let i = 0; i < 120; i += 1) {
        const world = new World({ seed: 20260909 + i });
        for (let t = 0; t < 60 * 150 && !world.defeated; t += 1) {
          // 스텝 "전"의 자리와 생사를 들고 있어야 한다 — 쓰러진 뒤에 재면 그 프레임에
          // 함께 움직인 값이 섞인다.
          const before = world.enemies.map((e) => ({ ...e.pos, id: e.id, alive: e.alive }));
          play(world, 1, walker.input);
          for (const e of world.enemies) {
            const was = before.find((b) => b.id === e.id);
            if (!was?.alive || e.alive) continue;
            let best = Infinity;
            for (const other of before) {
              if (other.id === e.id || !other.alive) continue;
              best = Math.min(best, Math.hypot(other.x - was.x, other.y - was.y));
            }
            if (Number.isFinite(best)) gaps.push(best);
          }
        }
      }
      gaps.sort((a, b) => a - b);
      const at = (p: number) => gaps[Math.floor(gaps.length * p)]!.toFixed(1);
      const within = (m: number) => ((gaps.filter((g) => g <= m).length / gaps.length) * 100).toFixed(1);
      console.log(
        `${walker.name}: 처치 ${gaps.length} · 곁의 적까지 중앙 ${at(0.5)}m · p10 ${at(0.1)} · p25 ${at(0.25)} | ` +
          `그 안에 든 처치 — 2.2m ${within(2.2)}% · 4.5m ${within(4.5)}% · 8m ${within(8)}%`,
      );
    }
  });
});
