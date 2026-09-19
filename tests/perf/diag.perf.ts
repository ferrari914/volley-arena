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
import {
  backOffBomber,
  circleShield,
  DT,
  holdNearEnemy,
  IDLE,
  play,
  sidestepCharger,
  stepOutOfLob,
  walkToNearestCore,
} from '../support/match';
import { clamp, wrapAngle } from '../../src/core/math';
import { AIM, ARENA, ARROW, ENEMY, SHIELD } from '../../src/data/config';
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
      /**
       * **150초 안에 쓰러진 판.** 세션 95가 앞선 자 넷에 함께 박은 칸이다 — 위의 다른 칸이
       * 전부 판을 다 더해 나눈 값이고, **150초에서 끊는 평균은 꼬리를 거의 못 본다**
       * (`tests/perf/tail.perf.ts` 머리말). 같은 오독이 두 번 났다: 세션 66이 안뜰을
       * 60판 평균(149 대 147초)으로 "한 판 길이가 그대로다"로 읽었는데 그 2초 안에
       * 5.8 → 13.1%가 있었고, 세션 92가 8m에서 멎는 것을 60판 평균(143 대 145초)으로
       * "공짜다"로 읽었는데 그 2초 안에 7/60 → 20/60이 있었다. 그래서 규칙이 아니라
       * **칸**으로 만든다(PROMPT ⑥). 60·120판은 꼬리를 가르기에는 좁은 창문이므로
       * (480판을 쓰는 까닭이 그것이다) **여기서 보이는 것은 몇 배로 갈리는 차이뿐이다** —
       * 한둘 차이로 읽지 말고, 움직였으면 `tail.perf.ts`로 넘겨라.
       */
      let dead = 0;
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
        if (world.defeated) dead += 1;
      }
      gaps.sort((a, b) => a - b);
      const at = (p: number) => gaps[Math.floor(gaps.length * p)]!.toFixed(1);
      const within = (m: number) => ((gaps.filter((g) => g <= m).length / gaps.length) * 100).toFixed(1);
      console.log(
        `${walker.name}: 처치 ${gaps.length} · 곁의 적까지 중앙 ${at(0.5)}m · p10 ${at(0.1)} · p25 ${at(0.25)} | ` +
          `그 안에 든 처치 — 2.2m ${within(2.2)}% · 4.5m ${within(4.5)}% · 8m ${within(8)}% · ` +
          `150초 안에 쓰러짐 ${dead}/120`,
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
 * **세션 81이 이 자에 먼 쪽 세 칸과 성장 세 칸을 더 달았다.** 코앞이 선 뒤로 남아 있던
 * 물음이 "그럼 거울은 어떤가 — 먼 데서 맞히는 데 값을 매기면"이었고, 그 장을 만들기 전에
 * 여기서 재고 닫았다. 답은 **거리 축이 대칭이 아니라는 것**이다: 가까운 쪽은 손 안 댄 사람이
 * 13.5%뿐이라 카드가 살 폭이 있는데, **먼 쪽은 손 안 대도 이미 43.7%가 10m 밖에서 난다**
 * (자동 조준이 가장 가까운 적을 잡아도 그 적이 대개 멀리 있다). 게다가 일부러 벌리면
 * 성장이 끊긴다 — 그래서 레벨·처치·경험치 전투 몫을 같은 줄에 함께 찍는다.
 * 카드 한 장을 닫은 근거이므로 **두 사람(`kite`)을 지우지 마라.**
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

  /**
   * `dive`의 거울 — 가장 가까운 적이 `keep`m 안에 들면 그 반대쪽으로 걷고,
   * 밖에 있으면 코어를 줍는 사람. **거리 축의 먼 쪽을 재려고 세운 사람이다**(세션 81).
   *
   * **벽에 몰리면 벽을 따라 돈다.** 반지름 26m 아레나에서 뒤로만 걸으면 등이 벽에 닿아
   * 그 뒤로는 제자리걸음이 되고, 그러면 재는 것이 카드가 아니라 그 사람의 막다른 골목이 된다.
   * 바깥 고리(`ARENA.radius - 3`)에 들면 멀어지는 성분을 접선으로 눕혀, 적을 등진 채
   * 벽을 따라 도는 쪽으로 바꾼다.
   *
   * **이 두 줄은 "먼 거리에 값을 매기는 카드"를 닫은 자다.** `pointblank`(코앞)의 거울인
   * 그 장은 두 문턱(`data/upgrades.ts`) 중 ②에서 걸린다 — 아래 줄이 그 값이다.
   * 벌리는 폭이 얕고(10m 밖 43.7% → 50.1% · 겨우 6.4%p) 그 얕은 폭의 값이
   * **한 판의 절반**이다(145 → 76초 · 레벨 13.7 → 4.7). 자세한 것은 `upgrades.ts` 머리말에 적었다.
   */
  const kite =
    (keep: number) =>
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
      if (!best || bestDist >= keep) return walkToNearestCore(world);
      let mx = (world.player.pos.x - best.pos.x) / bestDist;
      let my = (world.player.pos.y - best.pos.y) / bestDist;
      const r = Math.hypot(world.player.pos.x, world.player.pos.y);
      if (r > ARENA.radius - 3) {
        const nx = world.player.pos.x / r;
        const ny = world.player.pos.y / r;
        if (mx * nx + my * ny > 0) {
          const sign = mx * -ny + my * nx >= 0 ? 1 : -1;
          mx = -ny * sign;
          my = nx * sign;
        }
      }
      return { move: { x: mx, y: my }, aim: null };
    };

  const PEOPLE = [
    { name: '걷는 사람', input: walkToNearestCore },
    { name: '도는 사람', input: backOffBomber(circleShield) },
    { name: '파고드는 사람', input: backOffBomber(dive(5)) },
    { name: '물러나는 사람', input: kite(10) },
    { name: '멀리 서는 사람', input: kite(14) },
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
      // 거리만 재면 "누가 더 먼 데서 맞히는가"는 보이는데 **그 자리에 서는 값**이 안 보인다.
      // 레벨·처치·경험치 출처를 같은 판에서 함께 세어, 한 줄 안에서 둘을 나란히 읽게 한다
      // (세션 81 — 그 값이 먼 거리 카드를 닫았다). 판을 새로 돌리지 않으므로 공짜다.
      let levels = 0;
      let kills = 0;
      let xpDrop = 0;
      let xpAll = 0;
      // 150초 안에 쓰러진 판 — 위 '적끼리의 거리'의 주석을 보라(평균은 꼬리를 못 본다).
      let dead = 0;
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
        levels += world.progress.level;
        kills += world.kills;
        xpDrop += world.xpByOrigin.drop;
        xpAll += world.xpByOrigin.ambient + world.xpByOrigin.drop;
        if (world.defeated) dead += 1;
      }
      gaps.sort((a, b) => a - b);
      const at = (p: number) => gaps[Math.floor(gaps.length * p)]!.toFixed(1);
      const within = (m: number) =>
        ((gaps.filter((g) => g <= m).length / gaps.length) * 100).toFixed(1);
      const beyond = (m: number) =>
        ((gaps.filter((g) => g > m).length / gaps.length) * 100).toFixed(1);
      console.log(
        `${person.name.padEnd(8)}: 맞힘 ${gaps.length}(hits ${hits}) · 한 판 ${(secs / 60).toFixed(0)}초 · ` +
          `레벨 ${(levels / 60).toFixed(1)} · 처치 ${(kills / 60).toFixed(0)} · ` +
          `150초 안에 쓰러짐 ${dead}/60 · ` +
          `경험치 전투 몫 ${((xpDrop / xpAll) * 100).toFixed(0)}% · ` +
          `중앙 ${at(0.5)}m · p25 ${at(0.25)} | 그 안에 든 맞힘 — 4m ${within(4)}% · ` +
          `6m ${within(ARROW.pointBlankRange)}% · 8m ${within(8)}% | 그 밖에 난 맞힘 — ` +
          `10m ${beyond(10)}% · 12m ${beyond(12)}% · 14m ${beyond(14)}%`,
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
      // 150초 안에 쓰러진 판 — 위 '적끼리의 거리'의 주석을 보라(평균은 꼬리를 못 본다).
      let dead = 0;
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
        if (world.defeated) dead += 1;
      }
      console.log(
        `${person.name}: 맞힘 ${hits} · 그중 겨누는 중 ${((onWindup / hits) * 100).toFixed(1)}% ` +
          `(${onWindup}) · 한 발 1씩 더 깎았다면 총피해 ${hits + onWindup} · ` +
          `한 판 ${(secs / 60).toFixed(0)}초 · 처치 ${(kills / 60).toFixed(1)} · ` +
          `150초 안에 쓰러짐 ${dead}/60`,
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
      // 150초 안에 쓰러진 판 — 위 '적끼리의 거리'의 주석을 보라(평균은 꼬리를 못 본다).
      let dead = 0;
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
        if (world.defeated) dead += 1;
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
          `처치 ${(kills / 60).toFixed(1)} · 150초 안에 쓰러짐 ${dead}/60`,
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


/**
 * **맞는 순간 내 발이 멎어 있었는가** — 내 화살이 몸에 닿을 때 왼쪽 스틱이 놓여 있었나.
 *
 * 위의 넷과 한 줄에 선 다섯 번째 자다. 앞의 넷은 **거리**(적끼리 · 나와 적) · **때** ·
 * **각**을 물었고 넷 중 셋이 닫혔다. 이 자가 묻는 것은 **왼쪽 스틱의 길이**다 —
 * 열한 장 중 어느 것도 한 번도 본 적이 없는 값이고, 뒷걸음이 그 사실을 적어 두었다
 * (`systems/movement.ts`의 `backstepBoost`: *"길이를 빼고 방향만 본다"*).
 * 코앞은 스틱이 **나를 어디에 데려다 놓았는가**를 보고, 뒷걸음은 **어느 쪽으로
 * 미는가**를 본다. 남은 한 칸이 **얼마나 미는가**, 그 끝이 **아예 안 미는가**다.
 *
 * **세션 92가 열두째 화력 카드를 세우기 전에 여기서 쟀다. 그때는 열렸다고 읽었고,
 * 세션 94가 칸 하나를 더해 다시 읽으니 닫혔다** — 더한 칸은 맨 오른쪽 **꼬리**다.
 * 씨앗 60개 · 150초에서 끊는다 · '멎음'은 스틱 길이가 `AIM.deadzone`(0.18)보다 짧은 프레임:
 * | 사람 | 맞힘 | **멎은 채 난 맞힘** | 멎은 프레임 | 1씩 더 깎았다면 | 한 판 | 레벨 | 처치 | **꼬리** |
 * |---|---|---|---|---|---|---|---|---|
 * | 걷는 사람(손 안 댐) | 24661 | **0.9%** | 0.9% | 24880 | 145초 | 14.0 | 127 | **7/60** |
 * | 도는 사람 | 26963 | 0.2% | 0.2% | 27009 | 149초 | 14.2 | 138 | 2/60 |
 * | 멎는 사람 22m(보이면 멎는다) | 9584 | **86.0%** | 88.2% | 17831 | **63초** | **5.6** | 41 | 60/60 |
 * | 멎는 사람 10m | 15074 | 63.1% | 59.4% | 24582 | 92초 | 9.4 | 67 | 56/60 |
 * | 멎는 사람 9m | 19157 | 51.9% | 45.8% | 29106 | 114초 | 11.3 | 88 | 44/60 |
 * | **멎는 사람 8m** | 24111 | **34.1%** | 28.2% | **32337** | **141초** | 13.2 | 116 | **20/60** |
 * | **멎는 사람 6m** | 26712 | **10.8%** | 6.4% | 29592 | **150초** | 14.2 | 136 | **0/60** |
 * | 멎는 사람 4m | 26498 | 2.6% | 1.8% | 27182 | 150초 | 14.1 | 134 | 0/60 |
 *
 * (세션 92의 표와 왼쪽 칸들이 조금 다르다 — 겹 쌓는 순서가 그 뒤에 바뀌었다.
 * `tests/support/match.ts`의 '급한 것부터'. 읽는 것은 달라지지 않는다.)
 *
 * **(1) 시작점이 거의 0이다 — 이 자리에서 처음이다.** 손을 안 댄 사람은 맞힘의 **0.9%**만
 * 멎은 채로 낸다(코어가 다 떨어져 발이 멎는 몇 초다 · 세션 74). 세션 81이 먼 거리를 접은
 * 까닭이 정확히 그 반대였다 — 거기서는 손을 안 대도 43.7%가 이미 열려 있어서 **카드가 살
 * 것이 얼마 안 남아 있었다.** 여기서는 카드가 사는 것이 거의 전부 새 것이다.
 * **이 칸은 지금도 참이다.** 아래에서 닫히는 것은 이 칸이 아니다.
 *
 * **(2) 세션 92는 벼랑을 8 → 9m에서 봤다. 그 자리는 벼랑이 아니라 꼬리가 시작된 자리였다.**
 * 그때 본 칸은 **한 판**뿐이다 — 8m가 143초, 걷는 사람이 145초라 "공짜"로 읽었다.
 * 그런데 **150초에서 끊는 평균은 꼬리를 거의 못 본다.** 이 저장소가 이미 두 번 겪은
 * 오독이고(세션 66 → 68 · `tests/perf/tail.perf.ts` 머리말), 그래서 맨 오른쪽 칸을 더했다.
 * 같은 8m 줄의 141초 안에는 **쓰러진 판 스물**이 들어 있다 — 걷는 사람(7)의 **세 배**다.
 * 평균이 4초 움직이는 동안 꼬리는 11.7% → 33.3%가 됐다.
 *
 * **(3) 진짜 공짜인 선은 6m이고, 거기서는 두 문턱 중 ②가 안 선다.**
 * 6m에서 멎는 사람은 꼬리가 **0/60**이고 한 판이 150초로 아예 안 줄어든다. 공짜가 맞다.
 * 그런데 그 선에서 카드가 파는 폭은 **10.8%**이고, `data/upgrades.ts`의 문턱 ②가 요구하는
 * 화력 자리 한 장 값은 **12.6%**다(세션 61). **모자란다.** 8m로 넓히면 34.1%로 넉넉히
 * 넘지만 그때는 (2)가 운다.
 *
 * | 멎는 선 | 파는 폭 | 문턱 ②(12.6%) | 꼬리 |
 * |---|---|---|---|
 * | 4m | 2.6% | ✗ | 0/60 |
 * | **6m** | **10.8%** | **✗** | **0/60** |
 * | **8m** | **34.1%** | **○** | **20/60** |
 * | 9m 위 | 51.9%~ | ○ | 44/60~ |
 *
 * **둘이 함께 서는 칸이 없다. 그것이 이 축의 답이고, 여기서 닫는다.**
 * 세션 92가 "이 장이 묻는 것은 '멈춰라'가 아니라 '언제 멈춰도 되는가'"라고 적었는데,
 * 물음은 맞았고 **답이 "거의 언제도 안 된다"**였을 뿐이다.
 *
 * **(4) 끝까지 밀면 진다는 것은 그대로다.** 22m에서 멎는 사람은 멎은 몫이 86.0%로 가장 큰데
 * **카드를 얹은 총피해가 17831로 걷는 사람(24880)보다 작고** 꼬리가 60/60이다.
 * 세션 81의 물러나는 사람과 같은 모양이다.
 *
 * **세션 93의 480판 표와 이 표는 같은 말을 한다.** 그 바퀴는 카드를 다 만들어 놓고
 * "카드가 하는 일은 꼬리를 한 판도 못 움직이고 장 수만 움직인다"를 봤다
 * (`wip/steady-card` · `tests/perf/tail.perf.ts` 머리말). 여기서 보면 까닭이 보인다 —
 * **공짜인 폭이 카드 한 장 값보다 작으니 움직일 것이 없었던 것이다.**
 *
 * **재는 사람은 멎는 쪽에 유리하게 세웠다**(`armed` — 심지·떨어질 돌·몸을 던진 돌진형
 * 셋에서는 비킨다). 그러지 않으면 재는 것이 카드가 아니라 그 사람의 빈 구멍이 된다
 * (세션 51·74). **활잡이·방패병의 화살에는 답을 주지 않았다** — 서 있는 사람에게 그
 * 화살이 반드시 꽂히는 것이 이 카드가 치르는 값 그 자체다.
 *
 * 재는 자리는 위의 세 자와 같은 프레임이다(체력이 줄면 내 화살이 몸에 닿은 것이다).
 * **스틱은 그 프레임에 이 사람이 민 값 그대로다** — 화살이 떠난 순간이 아니라 닿은 순간의
 * 스틱이다(코앞이 닿는 순간의 거리를 재는 것과 같은 규칙). 화살이 날아가는 시간은
 * 중앙 거리 9.4m에서 0.28초이므로(`ARROW.speed` 34m/s), 쏘는 순간으로 재는 카드를
 * 만든다면 이 표보다 조금 더 큰 값이 나온다.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/diag.perf.ts
 */
describe('맞는 순간 내 발이 멎어 있었는가', () => {
  /**
   * 스틱이 이보다 짧으면 **발이 멎은 것**이다. 게임이 이미 쓰는 데드존 그대로라
   * (`AIM.deadzone`), 여기서 세는 프레임은 화면에서 실제로 발이 멎어 보이는 프레임이다.
   */
  const STILL = AIM.deadzone;

  /**
   * **멎는 쪽에 유리하게 세 답을 다 아는 사람이다** — 접는 쪽이 이기게 두면 접은 근거가
   * 약해진다(세션 64의 `snipeWindup`과 같은 규칙). 심지가 타면 원 밖으로 나가고
   * (`backOffBomber`), 돌이 떨어질 자리에서 비키고(`stepOutOfLob`), 몸을 던진 돌진형의
   * 직선에서 비킨다(`sidestepCharger`). 그 셋이 아닌 프레임에만 멎는다.
   *
   * **겹 넷은 `tests/support/match.ts`에서 가져다 쓴다**(세션 94가 옮겼다 — 세션 92는 이
   * 파일 안에 손으로 썼다). 쌓는 순서도 그 파일이 정한 순서 그대로다(급한 것부터).
   *
   * **활잡이·방패병의 화살에는 답이 없다. 그것이 이 카드의 값이다** —
   * 서 있는 사람에게는 그 화살이 반드시 꽂힌다.
   */
  const armed = (range: number) =>
    backOffBomber(sidestepCharger(stepOutOfLob(holdNearEnemy(range))));

  const PEOPLE = [
    { name: '걷는 사람', input: walkToNearestCore },
    { name: '도는 사람', input: backOffBomber(circleShield) },
    /**
     * **멎는 선을 여덟 자리 재서 여섯을 남겼다.** 지운 것은 11 · 7 · 5m이고(이웃과 같은
     * 이야기를 한다) 12m는 22m와 거의 같아서 지웠다(80.7% · 56초). 남긴 여섯이
     * **벼랑(8 → 9m)을 가운데 두고 양쪽을 보인다** — 이 줄들을 지우면 "여기까지는 공짜"를
     * 다시 낼 방법이 없다.
     */
    { name: '멎는 사람 22m', input: armed(AIM.autoRange) },
    { name: '멎는 사람 10m', input: armed(10) },
    { name: '멎는 사람 9m', input: armed(9) },
    { name: '멎는 사람 8m', input: armed(8) },
    { name: '멎는 사람 6m', input: armed(6) },
    { name: '멎는 사람 4m', input: armed(4) },
  ] as const;

  it('멎은 채로 얼마나 맞히는가', () => {
    for (const person of PEOPLE) {
      let hits = 0;
      let stillHits = 0;
      let frames = 0;
      let stillFrames = 0;
      let secs = 0;
      let levels = 0;
      let kills = 0;
      /**
       * **150초 안에 쓰러진 판.** 세션 94가 더한 칸이다 — 위 다섯 칸이 전부 평균이고,
       * **150초에서 끊는 평균은 꼬리를 거의 못 본다**(`tests/perf/tail.perf.ts` 머리말).
       * 세션 92가 이 표의 '한 판 143초'만 보고 "8m에서 멎는 것은 공짜다"로 읽었는데,
       * 그 143초 안에 **쓰러진 판 스물다섯**이 들어 있었다(걷는 사람은 다섯이다).
       * 60판은 꼬리를 가르기에는 좁은 창문이지만(480판을 쓰는 까닭이 그것이다) 여기서
       * 갈리는 차이는 다섯 배라 이 창문에서도 보인다.
       */
      let dead = 0;
      for (let i = 0; i < 60; i += 1) {
        const world = new World({ seed: 20260909 + i });
        for (let t = 0; t < 60 * 150 && !world.defeated; t += 1) {
          // 이번 프레임의 스틱. `play`가 곧바로 같은 함수를 같은 세계에 대고 다시 부르므로
          // 같은 값이다(이 사람들은 세계를 건드리지 않는다).
          const move = person.input(world).move;
          const still = Math.hypot(move.x, move.y) < STILL;
          const before = world.enemies.map((e) => ({ id: e.id, hp: e.hp }));
          play(world, 1, person.input);
          frames += 1;
          if (still) stillFrames += 1;
          for (const e of world.enemies) {
            const was = before.find((b) => b.id === e.id);
            // 체력이 줄었으면 내 화살이 몸에 닿은 것이다(위의 세 자와 같은 규칙).
            if (!was || e.hp >= was.hp) continue;
            hits += 1;
            if (still) stillHits += 1;
          }
        }
        secs += world.elapsed;
        levels += world.progress.level;
        kills += world.kills;
        if (world.defeated) dead += 1;
      }
      const pct = (n: number, d: number) => ((n / d) * 100).toFixed(1);
      console.log(
        `${person.name.padEnd(12)}: 맞힘 ${hits} · 그중 멎은 채 ${pct(stillHits, hits)}% ` +
          `(${stillHits}) · 발이 멎어 있던 프레임 ${pct(stillFrames, frames)}% | ` +
          `1씩 더 깎았다면 총피해 ${hits + stillHits}(+${pct(stillHits, hits)}%) · ` +
          `한 판 ${(secs / 60).toFixed(0)}초 · 레벨 ${(levels / 60).toFixed(1)} · ` +
          `처치 ${(kills / 60).toFixed(0)} · 150초 안에 쓰러짐 ${dead}/60`,
      );
    }
  });
});
