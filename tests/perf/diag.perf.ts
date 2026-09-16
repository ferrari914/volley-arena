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
import type { FrameInput } from '../../src/core/World';
import { MAPS } from '../../src/data/maps';
import { backOffBomber, circleShield, DT, IDLE, play, walkToNearestCore } from '../support/match';
import { AIM, ARROW, ENEMY, SHIELD } from '../../src/data/config';
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

/**
 * **나와 적 사이가 얼마나 가까운가** — 내 화살이 적의 몸에 닿는 그 순간의 거리.
 *
 * 왜 재 두는가: 위의 '적끼리의 거리'와 **짝을 이루는 자**다. 그 자가 닫은 갈래
 * ("적끼리의 거리를 보는 효과")를 대신해 열한째 카드가 간 자리가 여기이고
 * (`pointblank` · 코앞 · 세션 62), **이 자가 그 카드의 값을 정했다**
 * (`ARROW.pointBlankRange` 6m).
 *
 * **두 자의 답이 갈리는 지점이 이 프로젝트가 배운 것이다.** 적끼리의 거리는
 * 누가 어떻게 움직여도 같았다(11.8m 대 12.3m) — 그것은 아레나가 정하는 값이라
 * 카드가 살 수 없었다. 나와 적 사이는 **사람이 움직인다**: 아래 표에서 걷는 사람과
 * 파고드는 사람이 세 배 가까이 갈린다. 카드가 새 요구를 걸려면 **고른 사람이
 * 손으로 바꿀 수 있는 값**이어야 하고, 그것을 여기서 먼저 재고 넣는다.
 *
 * 재는 자리는 `systems/combat.ts`가 재는 자리와 **같은 프레임 · 같은 좌표**다 —
 * 화살은 스텝의 맨 끝에서 움직이므로(`core/World.ts`) 스텝이 끝난 뒤의 두 자리가
 * 곧 닿던 순간의 두 자리다. 한 프레임에 같은 적이 두 발을 맞으면 한 번으로 세는데,
 * 아래 '맞힘'과 `world.hits`를 나란히 찍어 그 몫이 얼마나 되는지 함께 보인다.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/diag.perf.ts
 */
describe('나와 적 사이의 거리', () => {
  /**
   * 가장 가까운 적이 `hug`m 밖이면 그쪽으로 걷고, 안에 들면 코어를 줍는 사람.
   *
   * **도는 사람과 같은 규칙으로 폭탄병에서만 물러난다**(`backOffBomber`). 안 씌우면
   * 한 판이 68초로 끝나 재는 것이 카드가 아니라 그 사람의 자살이 된다(실측).
   * 씌워도 붙는 일 자체는 그대로다 — 심지가 타는 프레임에만 비켜서기 때문이다.
   * 그래도 한 판은 짧아진다. 그 값도 아래 줄에 함께 찍는다:
   * **코앞이 공짜가 아니라는 것이 그 자리다.**
   */
  const dive =
    (hug: number) =>
    (world: World): FrameInput => {
      let best: (typeof world.enemies)[number] | null = null;
      let bestDist = Infinity;
      for (const e of world.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - world.player.pos.x, e.pos.y - world.player.pos.y);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
      if (!best || bestDist <= hug) return walkToNearestCore(world);
      return {
        move: {
          x: (best.pos.x - world.player.pos.x) / bestDist,
          y: (best.pos.y - world.player.pos.y) / bestDist,
        },
        aim: null,
      };
    };

  const PEOPLE = [
    { name: '걷는 사람', input: walkToNearestCore },
    { name: '도는 사람', input: backOffBomber(circleShield) },
    { name: '파고드는 사람', input: backOffBomber(dive(5)) },
  ] as const;

  it('닿는 순간 얼마나 붙어 있었는가', () => {
    for (const person of PEOPLE) {
      const gaps: number[] = [];
      let hits = 0;
      let secs = 0;
      for (let i = 0; i < 60; i += 1) {
        const world = new World({ seed: 20260909 + i });
        for (let t = 0; t < 60 * 150 && !world.defeated; t += 1) {
          const before = world.enemies.map((e) => ({ id: e.id, hp: e.hp }));
          play(world, 1, person.input);
          for (const e of world.enemies) {
            const was = before.find((b) => b.id === e.id);
            // 체력이 줄었으면 내 화살이 몸에 닿은 것이다. 방패가 받아 낸 화살은 체력을
            // 건드리지 않고(`systems/combat.ts`), 적을 깎는 다른 길은 없다.
            if (!was || e.hp >= was.hp) continue;
            gaps.push(Math.hypot(e.pos.x - world.player.pos.x, e.pos.y - world.player.pos.y));
          }
        }
        hits += world.hits;
        secs += world.elapsed;
      }
      gaps.sort((a, b) => a - b);
      const at = (p: number) => gaps[Math.floor(gaps.length * p)]!.toFixed(1);
      const within = (m: number) =>
        ((gaps.filter((g) => g <= m).length / gaps.length) * 100).toFixed(1);
      console.log(
        `${person.name}: 맞힘 ${gaps.length}(hits ${hits}) · 한 판 ${(secs / 60).toFixed(0)}초 · ` +
          `중앙 ${at(0.5)}m · p25 ${at(0.25)} | 그 안에 든 맞힘 — 4m ${within(4)}% · ` +
          `6m ${within(ARROW.pointBlankRange)}% · 8m ${within(8)}%`,
      );
    }
  });
});

/**
 * **맞는 순간 적이 무엇을 하고 있었는가** — 내 화살이 몸에 닿을 때 그 적이 겨누는 중이었나.
 *
 * 위의 두 자와 한 줄에 선 세 번째 자다. 앞의 둘이 **거리**를 물었다면(적끼리 · 나와 적),
 * 이 자는 **때**를 묻는다 — 화력 다섯 장이 한 번도 묻지 않은 것이다(연사·다중 발사·관통·
 * 튕김은 "더 많이 · 더 자주", 코앞은 "어디에 서 있는가"). 세션 64가 그 자리에 열두째 장
 * ("겨누는 적을 1 더 깎는다")을 세우려다, **만들기 전에 여기서 재고 접었다.**
 *
 * 재는 것은 `e.aimTimer > 0`, 곧 **저지르기 직전의 적**이다. 네 종류가 이 타이머 하나를
 * 함께 쓰므로(`entities/types.ts`) 활잡이의 겨눔 · 돌진형의 웅크림 · 폭탄병의 심지 ·
 * 방패병의 겨눔이 한 줄로 읽힌다. 화면에도 이미 그려져 있고(적이 붉게 달아오르고 발밑
 * 고리가 좁혀진다 · `ENEMY.aimTime`), **게임이 이미 한 곳에서 같은 규칙을 쓴다** —
 * 방패병은 겨누는 동안 방패를 내린다(`systems/combat.ts`의 `blocksArrow`:
 * "가장 위험한 순간이 곧 가장 무른 순간").
 *
 * **재 보니 그 카드는 노릴 수 없는 카드였다.** 아래 표의 맨 오른쪽 두 칸이 그것이다:
 * 손을 안 대고 걷기만 해도 맞힘의 5분의 1이 겨누는 적에게 들어가는데(19%),
 * 오른쪽 스틱으로 **일부러 노리면 겨눔 몫은 6%p 오르고 맞힘 자체가 그보다 많이 줄어**
 * 총피해가 도리어 내려간다. 노리는 사람을 두 번 다듬어도(사거리 12m로 좁히고,
 * 화살이 닿기 전에 쏴 버릴 적은 건너뛰고) 걷는 사람을 넘지 못했다.
 *
 * **이유는 카드가 아니라 자동 조준이다.** 자동 조준은 늘 가장 가까운 적을 잡고
 * (`systems/autoAim.ts`), **가장 가까운 적이 곧 가장 자주 겨누는 적이다**(사거리 안에
 * 오래 머무르므로). 그래서 "겨누는 놈으로 조준을 돌려라"라는 요구는 이미 하고 있는 일을
 * 다시 시키는 것이거나, 더 먼 놈을 보느라 손해를 보는 일 둘 중 하나가 된다.
 *
 * **그러므로 표적을 고르는 일에 값을 매기는 카드는 자동 조준이 있는 동안 닫혀 있다.**
 * 값을 걸려면 **왼쪽 스틱으로 움직일 수 있는 것**이어야 한다(`data/upgrades.ts`에
 * 세 장의 결과를 나란히 적어 두었다). 이 갈래를 다시 열려면 여기부터 다시 재라.
 *
 * 재는 자리는 `systems/combat.ts`가 재는 자리와 같다 — 적이 먼저 움직이고
 * (`updateEnemies`) 화살이 스텝의 맨 끝에서 닿으므로(`core/World.ts`), 스텝이 끝난 뒤의
 * `aimTimer`가 곧 닿던 순간의 값이다. **쓰러뜨린 한 발만 예외다**: 눕는 순간 combat이
 * `aimTimer`를 0으로 지우므로, 그때는 스텝 "전"의 값이 한 프레임분(DT)보다 컸는지로 본다
 * (그 프레임에 겨눔을 새로 시작하면서 동시에 쓰러진 한 발은 놓친다 — 드물다).
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/diag.perf.ts
 */
describe('맞는 순간 적이 무엇을 하고 있었는가', () => {
  /**
   * **겨누는 적으로 조준을 돌리는 사람.** 걷는 것은 `inner`가 하고 이 사람은 손만 쓴다
   * (오른쪽 스틱 · `FrameInput.aim`). 겨누는 적이 없으면 손을 떼 자동 조준에 맡긴다.
   *
   * **노리는 쪽에 유리하게 두 번 다듬었다** — 접는 쪽이 이기게 두면 접은 근거가 약해진다:
   * 화살이 가는 동안 이미 쏴 버릴 적은 건너뛰고(`d / speed < aimTimer`), 너무 먼 적을
   * 쫓다 가까운 적을 놓치지 않게 12m로 끊는다. 22m까지 열어 보면 겨눔 몫은 25.7%까지
   * 오르지만 총피해는 26762로 더 내려간다(걷는 사람 27944).
   *
   * **보는 것은 화면에 있는 것뿐이다**(`dodgeCharger`·`circleShield`와 같은 규칙) —
   * 달아오른 몸과 좁혀지는 발밑 고리다. 아직 겨누지 않은 적이 곧 겨눌 것을 미리 아는
   * 사람은 만들지 않는다. 그런 사람이 재는 값은 사람이 낼 수 없는 값이다.
   */
  /** 이보다 먼 적은 노리지 않는다(m). 넓히면 겨눔 몫은 오르고 총피해는 내려간다. */
  const SNIPE_RANGE = 12;

  const snipeWindup =
    (inner: (w: World) => FrameInput) =>
    (world: World): FrameInput => {
      const base = inner(world);
      let best: (typeof world.enemies)[number] | null = null;
      let bestDist = Math.min(SNIPE_RANGE, AIM.autoRange);
      for (const e of world.enemies) {
        if (!e.alive || e.aimTimer <= 0) continue;
        const d = Math.hypot(e.pos.x - world.player.pos.x, e.pos.y - world.player.pos.y);
        if (d / ARROW.speed >= e.aimTimer) continue;
        if (d <= bestDist) {
          bestDist = d;
          best = e;
        }
      }
      if (!best) return base;
      return {
        move: base.move,
        aim: { x: best.pos.x - world.player.pos.x, y: best.pos.y - world.player.pos.y },
      };
    };

  const PEOPLE = [
    { name: '걷는 사람', input: walkToNearestCore },
    { name: '도는 사람', input: backOffBomber(circleShield) },
    { name: '틈을 노리는 사람', input: snipeWindup(backOffBomber()) },
  ] as const;

  it('겨누는 중인 적을 얼마나 맞히는가', () => {
    for (const person of PEOPLE) {
      let hits = 0;
      let onWindup = 0;
      let secs = 0;
      let kills = 0;
      for (let i = 0; i < 60; i += 1) {
        const world = new World({ seed: 20260909 + i });
        for (let t = 0; t < 60 * 150 && !world.defeated; t += 1) {
          const before = world.enemies.map((e) => ({ id: e.id, hp: e.hp, aim: e.aimTimer }));
          play(world, 1, person.input);
          for (const e of world.enemies) {
            const was = before.find((b) => b.id === e.id);
            if (!was || e.hp >= was.hp) continue;
            hits += 1;
            if (e.alive ? e.aimTimer > 0 : was.aim > DT) onWindup += 1;
          }
        }
        secs += world.elapsed;
        kills += world.kills;
      }
      console.log(
        `${person.name}: 맞힘 ${hits} · 그중 겨누는 중 ${((onWindup / hits) * 100).toFixed(1)}% ` +
          `(${onWindup}) · 한 발 1씩 더 깎았다면 총피해 ${hits + onWindup} · ` +
          `한 판 ${(secs / 60).toFixed(0)}초 · 처치 ${(kills / 60).toFixed(1)}`,
      );
    }
  });
});
