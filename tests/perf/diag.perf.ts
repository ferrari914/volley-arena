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
import { MAPS, type ArenaMap } from '../../src/data/maps';
import { backOffBomber, circleShield, DT, IDLE, play, walkToNearestCore } from '../support/match';
import { clamp, wrapAngle } from '../../src/core/math';
import { AIM, ARROW, ENEMY, SHIELD } from '../../src/data/config';
import { sightBlocker } from '../../src/systems/obstacles';

const SEEDS = Array.from({ length: 8 }, (_, i) => 20260909 + i);
const SPOTS = [
  { map: 0, name: '빈 뜰 한복판', r: 0, deg: 0 },
  { map: 0, name: '빈 뜰 r24·30', r: 24, deg: 30 },
  { map: 1, name: '기둥 한복판', r: 0, deg: 0 },
  { map: 1, name: '기둥 r20·60', r: 20, deg: 60 },
  { map: 1, name: '기둥 r22·330', r: 22, deg: 330 },
  // 네째 맵(세션 66). **한복판인데 '가림' 칸이 0이 아닌 유일한 줄이다** — 앞의 세 맵은
  // 가림을 전부 벽 앞에 두어서 한복판에 선 사람에게는 기둥이 없는 것과 같다
  // (`data/maps.ts`의 안뜰 주석 · 한복판 가림 0도 대 112도).
  { map: 3, name: '안뜰 한복판', r: 0, deg: 0 },
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
    /**
     * **손을 안 대는 같은 사람을 안뜰에 세운 줄**(세션 66). 위 셋은 전부 빈 뜰이다 —
     * 사람이 바뀔 때 이 값이 얼마나 움직이는지는 그 셋이 말하고, 이 줄은 **맵이 바뀔 때**를
     * 말한다. 네째 맵이 노린 것이 바로 이 값이라(`data/maps.ts`의 안뜰 주석), 그 주장을
     * 매 바퀴 한 줄로 다시 보게 둔다. 걷는 사람과 짝지어 읽어라 — 다른 것은 맵뿐이다.
     */
    { name: '걷는 사람 · 안뜰', input: walkToNearestCore, map: MAPS[3] as ArenaMap },
  ] as const;

  it('닿는 순간 얼마나 붙어 있었는가', () => {
    for (const person of PEOPLE) {
      const gaps: number[] = [];
      let hits = 0;
      let secs = 0;
      for (let i = 0; i < 60; i += 1) {
        const world = new World({ seed: 20260909 + i, map: 'map' in person ? person.map : MAPS[0]! });
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
        `${person.name.padEnd(8)}: 맞힘 ${gaps.length}(hits ${hits}) · 한 판 ${(secs / 60).toFixed(0)}초 · ` +
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

/**
 * **맞는 순간 내가 어디에 서 있었는가** — 내 화살이 몸에 닿을 때 그 적의 등 쪽이었나.
 *
 * 위의 셋과 한 줄에 선 네 번째 자다. 앞의 셋이 **거리**(적끼리 · 나와 적)와 **때**를
 * 물었다면 이 자는 **각**을 묻는다. 세션 65가 열두째 화력 카드의 후보로 이 값을 대 보고,
 * **만들기 전에 여기서 재고 접었다.**
 *
 * **왜 재 봤는가.** 세션 64가 남긴 규칙은 "카드의 값은 **왼쪽 스틱으로 움직일 수 있어야
 * 한다**"였고(`data/upgrades.ts` 머리말), 등 뒤는 그 조건을 겉보기에 만족했다 —
 * 적을 돌아 들어가는 것은 발로 하는 일이다. 게다가 **게임이 이미 한 곳에서 같은 각을 쓴다**:
 * 방패병의 정면 부채꼴(`SHIELD.arc` 75°)이고, DESIGN 9번이 그 적에게 건 요구가
 * 바로 "돌아서 쏴라"다.
 *
 * **재 보니 각은 왼쪽 스틱으로 움직일 수 있는 값이 아니었다 — 적이 나를 보기 때문이다.**
 * 씨앗 60개 · 뒤 150°(방패의 정면을 그대로 뒤집은 값):
 * | 사람 | 맞힘 | 각 p75 | 각 p90 | **뒤 150°** | 활잡이 / 돌진형 / 방패병 / 폭탄병 |
 * |---|---|---|---|---|---|
 * | 걷는 사람(손 안 댐) | 23424 | 0.4° | 15.5° | **1.5%** | 0.3 / 0.7 / 8.4 / 0.7% |
 * | 도는 사람 | 24360 | 0.4° | 30.3° | 2.1% | 0.3 / 0.7 / 11.3 / 0.2% |
 * | 돌아 들어가는 사람 | 25488 | 1.2° | 50.6° | **4.7%** | 0.2 / 9.9 / 13.3 / 0.1% |
 *
 * **맞힘의 4분의 3이 정면 1° 안에서 난다.** 왼쪽 스틱을 통째로 이 한 가지에 쓰는 사람도
 * 1.5%를 4.7%로 올릴 뿐이다(코앞은 같은 자리에서 13.5%를 46.5%로 올렸다 — 세 배가 아니라
 * 서른 배 큰 판이다). **이 값을 정하는 것은 카드도 사람도 아니고 적의 `turnRate`다**:
 * 플레이어(7.2m/s)가 거리 d에서 도는 각속도 `7.2 / d`가 적이 따라 도는 속도와 같아지는
 * 거리는 활잡이·폭탄병 **2.25m** · 돌진형 2.77m · 방패병 9m다. 곧 **활잡이와 폭탄병의
 * 등은 2.25m 안으로 파고들어야만 열리고**, 그 거리는 이미 코앞 카드가 값을 매긴 자리다.
 *
 * **남는 것은 방패병과 돌진형 둘뿐인데, 그 둘은 이미 그 각에 값을 매겨 두었다.**
 * 방패병의 등은 `blocksArrow`가 이미 연다(정면 8발 대 옆구리 3발). 돌진형의 등이 열리는
 * 것은 몸을 던지는 동안 `facing`이 잠기기 때문이고(`dashTimer`), 그 순간 옆으로 비키는
 * 것이 DESIGN이 그 적에게 건 요구 그 자체다. **각을 사는 카드는 적 넷 중 둘에게는 아무 말도
 * 못 하고, 나머지 둘에게는 게임이 이미 하는 말을 한 번 더 한다.**
 *
 * **그러므로 맞는 각에 값을 매기는 카드는 적이 나를 보는 동안 닫혀 있다.**
 * 이 갈래를 다시 열 일이 있다면(등을 보이고 걷는 적, 또는 적의 `turnRate`를 깎는 수단이
 * 생긴다면) 여기부터 다시 재라.
 *
 * ---
 *
 * **그 적이 생겼다. 다시 쟀다(세션 71).** 세션 69가 세운 약탈꾼은 코어를 보고 걷는
 * 다섯째 적이다(`LOOTER` · `stepLooter`). 위 문단이 적어 둔 조건 그대로라 **이 자의 종류
 * 칸에 다섯째 줄을 넣고 같은 씨앗 60개로 다시 돌렸다.** 표가 건드린 것은 이 파일 한 줄뿐이고
 * (`KINDS`), `src/`는 한 줄도 바뀌지 않았다.
 * | 사람 | 맞힘 | **뒤 150°** | 활잡이 / 돌진형 / 방패병 / 폭탄병 / **약탈꾼** |
 * |---|---|---|---|
 * | 걷는 사람(손 안 댐) | 23959 | **3.1%** | 0.4 / 0.8 / 8.8 / 0.8 / **19.7**% (1997) |
 * | 도는 사람 | 25571 | 3.9% | 0.3 / 0.8 / 13.9 / 0.1 / **21.1**% (1846) |
 * | 돌아 들어가는 사람 | 26202 | **7.5%** | 0.3 / 12.3 / 13.9 / 0.2 / **40.5**% (1586) |
 *
 * **셋을 읽는다.**
 * **(1) 등은 실제로 열렸다 — 넷 중 어느 것보다 크게.** 손을 안 댄 사람 기준 19.7%는
 * 활잡이(0.4%)의 쉰 배이고 방패병(8.8%)의 갑절이다. 위 표의 옛 줄(세션 65)에서 네 종류의
 * 값은 거의 그대로다 — **움직인 것은 전부 약탈꾼이 가져온 몫이다**(온 사람 1.5 → 3.1%).
 * **(2) 그런데 그 절반 이상이 거저 열린다.** 손을 안 댄 사람의 뒤 150° 맞힘 743발 중
 * 약탈꾼이 393발(53%)이다. 활잡이의 등이 2.25m 안으로 파고들어야 열리는 것과 달리
 * 이 적의 등은 **내가 아무것도 안 해도** 열려 있다 — 그 적이 나를 안 보기 때문이다.
 * **(3) 그래도 왼쪽 스틱이 닿기는 한다** — 19.7 → 40.5%로 갑절이 된다(×2.06).
 * 이 갑절은 돌진형(0.8 → 12.3%)과 함께 이 표에서 스틱이 실제로 움직이는 두 칸이다.
 *
 * **그러므로 갈래는 열렸지만, 열린 문으로 들어가면 값이 엉뚱한 곳에 붙는다.**
 * 각에 값을 매기는 카드는 **다섯 중 유일하게 나를 아프게 하지 않는 적**에게 값의 절반을
 * 치른다(약탈꾼은 화살도 몸통도 폭발도 없다 · `LOOTER` 머리말). 게다가 그 적의 체력은
 * 2이므로(`LOOTER.maxHp`) 등에 1을 더 얹으면 **두 발이 한 발이 된다** — 곧 이 카드의
 * 값은 '각을 사는 값'이 아니라 **'약탈꾼을 한 발에 지우는 값'**으로 읽히고,
 * 그것은 세션 64가 세운 규칙("카드의 값은 왼쪽 스틱으로 움직일 수 있어야 한다")을
 * 글자로는 통과하지만 뜻으로는 통과하지 못한다.
 *
 * **`data/upgrades.ts`의 두 문턱으로 읽으면 이렇게 갈린다.**
 * **①(왼쪽 스틱으로 움직이는 값인가)는 이제 통과한다** — 약탈꾼 한 마리에서 19.7 → 40.5%다.
 * **②(움직이는 폭이 카드 한 장 값을 내는가)는 여전히 못 넘는다.** 이 자가 찍는
 * '1씩 더 깎았다면 총피해'가 그대로 답이다 — 등에 1을 더 얹는 카드가 버는 것은
 * **총피해 +3.1%(손 안 댄 사람) ~ +7.5%(돌아 들어가는 사람)**이고, 화력 자리 한 장은
 * 고른 사람의 12.6%를 가져간다(세션 61). **버는 것보다 자리값이 크다.**
 * 다만 **판은 세션 65보다 커졌다** — 그때 1.5 → 4.7%(3.2%p)였던 폭이 3.1 → 7.5%(4.4%p)다.
 * 코앞의 13.5 → 46.5%(33%p)에 견주면 스무 배 작던 것이 일곱 배 작은 정도가 됐다.
 * **닫힌 채로 두되, 이 갈래를 다시 여는 것은 카드가 아니라 적의 수라는 것이 이 표에 보인다** —
 * 움직인 것이 약탈꾼 **한 종류**뿐인데 폭이 4할 늘었다.
 *
 * **다음에 이 자리를 보는 바퀴가 물을 것은 '각 카드를 만들까'가 아니다.**
 * 물을 것은 **"약탈꾼의 등에 값을 매기는 것이 이 적이 던진 물음(쫓아가라)을 더 또렷하게
 * 하는가, 아니면 지우는가"**다. 쫓아가서 등에 꽂는 것은 이 적이 이미 시키는 일이므로
 * 전자일 수 있고, 두 발이 한 발이 되면 쫓아갈 거리가 짧아지므로 후자일 수도 있다.
 * **재지 않고 답하지 마라.** 잴 자리는 이 자가 아니라 `tail.perf.ts`의 걷는/도는 비다.
 *
 * 재는 자리는 위의 '나와 적 사이의 거리'와 같은 프레임이다. 다만 **각은 화살이 날아온
 * 방향이 아니라 내가 선 자리로 잰다**(`atan2(나 - 적)`) — `combat.ts`의 `blocksArrow`는
 * 속도로 재지만(한 프레임에 몸통보다 멀리 나아간 화살이 몸 반대편에서 판정되므로),
 * 여기서 물어야 하는 것은 "그 화살이 어디서 왔는가"가 아니라 **"고른 사람이 어디에 서
 * 있었는가"**다. 카드가 사는 것은 자리이지 화살이 아니다.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/diag.perf.ts
 */
describe('맞는 순간 내가 어디에 서 있었는가', () => {
  /** 등으로 치는 부채꼴의 반각(rad). 방패의 정면(`SHIELD.arc` 75°)을 그대로 뒤집은 값이다. */
  const BACK = SHIELD.arc;

  /**
   * **등 뒤로 돌아 들어가는 사람.** 자동 조준이 잡은 적(`lockedEnemy` — 내 화살이 가는 곳)의
   * 뒤로 돌면서 `orbit`m을 지킨다. **왼쪽 스틱만 쓴다** — 오른쪽 스틱은 손대지 않는다.
   * 그래야 재는 것이 '자리'가 되고, 표적을 고르는 일(세션 64가 닫은 갈래)이 섞이지 않는다.
   *
   * 도는 규칙은 `circleShield`와 같다(지금 서 있는 쪽으로 돌고, 붙는 몫과 도는 몫을 더해
   * 정규화한다 · `tests/support/match.ts`). 다른 것은 **적 넷을 가리지 않는다**는 것뿐이다.
   *
   * **돌아가는 쪽에 유리하게 골랐다** — 접는 쪽이 이기게 두면 접은 근거가 약해진다.
   * 거리를 셋(1.4 · 2.2 · 3.0m), 등 부채꼴에 들면 도는 것을 멈추는 쪽과 계속 도는 쪽을
   * 재서 가장 높은 값을 남겼다(뒤 150° 기준): 멈추면 2.7% · 계속 돌면 **4.7%**다.
   * 적이 곧 따라 돌므로 **등은 서 있는 자리가 아니라 계속 돌아야 하는 자리**다.
   * (1.4m까지 붙이면 4.9%로 거의 같고 맞힘이 준다. 2.2m가 총피해로 가장 낫다.)
   */
  const flank =
    (orbit: number) =>
    (world: World): FrameInput => {
      const target = world.lockedEnemy;
      if (!target || !target.alive) return walkToNearestCore(world);
      const dx = world.player.pos.x - target.pos.x;
      const dy = world.player.pos.y - target.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) return walkToNearestCore(world);
      // 적이 보는 방향에서 내가 몇 도나 비켜 서 있는가. `circleShield`가 재는 것과 같은 각이다.
      const off = wrapAngle(Math.atan2(dy, dx) - target.facing);
      const sign = off >= 0 ? 1 : -1;
      const pull = clamp((dist - orbit) / 2, -1, 1);
      const move = {
        x: (-dy / dist) * sign - (dx / dist) * pull,
        y: (dx / dist) * sign - (dy / dist) * pull,
      };
      const len = Math.hypot(move.x, move.y);
      if (len < 1e-6) return walkToNearestCore(world);
      return { move: { x: move.x / len, y: move.y / len }, aim: null };
    };

  const PEOPLE = [
    { name: '걷는 사람', input: walkToNearestCore },
    { name: '도는 사람', input: backOffBomber(circleShield) },
    { name: '돌아 들어가는 사람', input: backOffBomber(flank(2.2)) },
  ] as const;

  /** 종류별로 갈라 찍는다 — 각이 열리는 적과 끝내 안 열리는 적이 여기서 갈린다. */
  const KINDS = [
    ['archer', '활잡이'],
    ['charger', '돌진형'],
    ['shield', '방패병'],
    ['bomber', '폭탄병'],
    ['looter', '약탈꾼'],
  ] as const;

  it('등 뒤에서 얼마나 맞히는가', () => {
    for (const person of PEOPLE) {
      const angles: number[] = [];
      const byKind = new Map<string, { hits: number; back: number }>();
      let secs = 0;
      let kills = 0;
      for (let i = 0; i < 60; i += 1) {
        const world = new World({ seed: 20260909 + i });
        for (let t = 0; t < 60 * 150 && !world.defeated; t += 1) {
          const before = world.enemies.map((e) => ({ id: e.id, hp: e.hp }));
          play(world, 1, person.input);
          for (const e of world.enemies) {
            const was = before.find((b) => b.id === e.id);
            // 체력이 줄었으면 내 화살이 몸에 닿은 것이다(위의 '나와 적 사이의 거리'와 같은 규칙).
            if (!was || e.hp >= was.hp) continue;
            const off = Math.abs(
              wrapAngle(
                Math.atan2(world.player.pos.y - e.pos.y, world.player.pos.x - e.pos.x) - e.facing,
              ),
            );
            angles.push(off);
            const row = byKind.get(e.kind) ?? { hits: 0, back: 0 };
            row.hits += 1;
            if (off >= Math.PI - BACK) row.back += 1;
            byKind.set(e.kind, row);
          }
        }
        secs += world.elapsed;
        kills += world.kills;
      }
      angles.sort((a, b) => a - b);
      const deg = (p: number) => (((angles[Math.floor(angles.length * p)]! * 180) / Math.PI)).toFixed(1);
      const beyond = (rad: number) =>
        ((angles.filter((a) => a >= rad).length / angles.length) * 100).toFixed(1);
      const back = angles.filter((a) => a >= Math.PI - BACK).length;
      console.log(
        `${person.name}: 맞힘 ${angles.length} · 정면에서 비껴난 각 p50 ${deg(0.5)}° · ` +
          `p75 ${deg(0.75)}° · p90 ${deg(0.9)}° | 뒤 150°(방패의 거울) ${beyond(Math.PI - BACK)}% · ` +
          `뒤 90° ${beyond(Math.PI * 0.75)}% · 등 60° ${beyond((Math.PI * 5) / 6)}% | ` +
          `1씩 더 깎았다면 총피해 ${angles.length + back} · 한 판 ${(secs / 60).toFixed(0)}초 · ` +
          `처치 ${(kills / 60).toFixed(1)}`,
      );
      console.log(
        `  종류별 뒤 150° — ` +
          KINDS.map(([kind, label]) => {
            const row = byKind.get(kind);
            if (!row) return `${label} —`;
            return `${label} ${((row.back / row.hits) * 100).toFixed(1)}%(${row.hits})`;
          }).join(' · '),
      );
    }
  });
});
