/**
 * **판이 갈수록 적의 종류가 묽어지는가** — 일곱 종류의 몫을 시간 띠로 갈라 보는 자.
 *
 * STATUS.md가 세션 71·76 두 번에 걸쳐 "폭탄병·약탈꾼·투석병은 처음 배치의 한 마리가
 * 전부이고 **죽으면 그 판에서 다시 안 나온다**"고 적어 두었다. **그 절반이 틀렸다.**
 * 쓰러진 적은 `ENEMY.respawnDelay`(3.6초) 뒤에 **같은 종류 그대로 다시 선다**
 * (`systems/enemyAi.ts`의 `revive` · `core/World.ts`는 적을 배열에서 지우는 일이 없다).
 * 곧 일곱 종류는 판이 끝날 때까지 **한 마리씩 그대로 있다.** 아래 '일곱은 끝까지 있다'가
 * 그것을 매번 다시 확인한다 — 같은 오해가 세 번째로 STATUS에 적히지 않도록.
 *
 * **그러면 무엇이 진짜 묽어지는가.** 두 가지이고, 이 자가 재는 것이 그 둘이다.
 *   ① **몸의 몫** — 증원 열둘이 전부 활잡이·돌진형·방패병이라(`REINFORCE.order`)
 *      일곱 중 셋은 수가 안 는다. 처음 3/7인 몫이 끝에는 3/19가 된다.
 *   ② **누워 있는 몫** — 다시 서기까지 3.6초가 걸리므로, 체력이 낮아 자주 눕는 적은
 *      "있는데 없는" 시간이 길다(약탈꾼 `maxHp` 2 · 폭탄병은 제 몸으로 터져 스스로 눕는다).
 *
 * 세 번째 칸은 **자동 조준이 누구를 잡고 있었는가**다(`AIM.autoRange` 22m 안에서 가장 가까운
 * 적 · `systems/autoAim.ts`). 몸의 몫과 갈리는 칸이라 따로 센다 — 내 화살이 실제로 어디로
 * 가는지는 수가 아니라 거리가 정하고, 이 게임에서 거리는 종류마다 다르다
 * (돌진형은 달려들고 투석병은 멀리 선다).
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/mix.perf.ts
 */
import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/World';
import { AIM } from '../../src/data/config';
import { DEFAULT_MAP } from '../../src/data/maps';
import type { EnemyKind } from '../../src/entities/types';
import { findNearestEnemy } from '../../src/systems/autoAim';
import { DT, play, takeAny, walkToNearestCore } from '../support/match';

/** 다른 표와 같은 자리에서 시작한다(`balance.perf.ts` · `tail.perf.ts`). */
const SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + i);
/** 판이 끝나지 않아도 여기서 끊는다(s). `playMatch`의 기본값과 같다. */
const CAP = 600;

/** 시간 띠의 경계(s). 마지막 띠는 열려 있다. */
const BANDS = [0, 60, 120, 180, 240] as const;

/** 표에 쓰는 이름. `EnemyKind`를 그대로 열거하지 않는 이유는 순서를 정하기 위해서다. */
const KINDS: readonly { kind: EnemyKind; name: string }[] = [
  { kind: 'archer', name: '활잡이' },
  { kind: 'charger', name: '돌진형' },
  { kind: 'shield', name: '방패병' },
  { kind: 'bomber', name: '폭탄병' },
  { kind: 'looter', name: '약탈꾼' },
  { kind: 'lobber', name: '투석병' },
];

function bandOf(elapsed: number): number {
  let i = 0;
  while (i + 1 < BANDS.length && elapsed >= (BANDS[i + 1] as number)) i += 1;
  return i;
}

function bandName(i: number): string {
  const from = BANDS[i] as number;
  const to = BANDS[i + 1];
  return to === undefined ? `${from}초~` : `${from}~${to}초`;
}

interface Tally {
  /** 이 띠에서 돌린 프레임 수. 몫의 분모다. */
  frames: number;
  /** 종류별 "살아 서 있던" 프레임 수(몸 하나가 한 프레임에 1). */
  alive: Map<EnemyKind, number>;
  /** 종류별 "누워 있던" 프레임 수. `alive`와 더하면 그 띠에 있던 몸의 수가 나온다. */
  down: Map<EnemyKind, number>;
  /** 종류별 자동 조준 표적이었던 프레임 수. 표적이 없는 프레임은 어디에도 안 센다. */
  aimed: Map<EnemyKind, number>;
}

function newTally(): Tally {
  return { frames: 0, alive: new Map(), down: new Map(), aimed: new Map() };
}

function bump(m: Map<EnemyKind, number>, k: EnemyKind, by = 1): void {
  m.set(k, (m.get(k) ?? 0) + by);
}

function sum(m: Map<EnemyKind, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}

/** 몫을 백분율 한 자리로. 분모가 0이면 빈칸을 돌려준다(그 띠까지 간 판이 없다). */
function share(part: number, whole: number): string {
  return whole <= 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

describe('적 일곱 종류의 몫', () => {
  it('판이 갈수록 무엇이 묽어지는가', () => {
    const tallies = BANDS.map(() => newTally());
    /** 판이 끝난 순간 각 종류가 몇 마리 남아 있었는가(누운 것도 센다). */
    const atEnd = new Map<EnemyKind, number>();
    let matches = 0;

    for (const seed of SEEDS) {
      const world = new World({ seed, map: DEFAULT_MAP });
      const steps = Math.round(60 * CAP);
      for (let i = 0; i < steps && !world.defeated; i += 1) {
        play(world, 1, walkToNearestCore, takeAny);
        // 카드가 떠 있는 동안에는 시간이 흐르지 않는다(`World.isPaused`). 그 프레임을
        // 세면 멈춰 있는 장면이 띠의 몫을 부풀린다 — 고르는 데 걸린 시간만큼 늘어난다.
        if (world.isPaused) continue;
        const t = tallies[bandOf(world.elapsed)] as Tally;
        t.frames += 1;
        for (const e of world.enemies) bump(e.alive ? t.alive : t.down, e.kind);
        const target = findNearestEnemy(world.player.pos, world.enemies, AIM.autoRange);
        if (target) bump(t.aimed, target.kind);
      }
      for (const e of world.enemies) bump(atEnd, e.kind);
      matches += 1;
    }

    console.log(`\n적 일곱 종류의 몫 — 걷는 사람 · 씨앗 ${matches}판 · ${DEFAULT_MAP.name}`);
    for (let i = 0; i < tallies.length; i += 1) {
      const t = tallies[i] as Tally;
      if (t.frames === 0) {
        console.log(`  ${bandName(i)}: 그 띠까지 간 판이 없다`);
        continue;
      }
      const bodies = sum(t.alive) + sum(t.down);
      const aimedTotal = sum(t.aimed);
      console.log(
        `  ${bandName(i)} (${(t.frames * DT).toFixed(0)}초 분량 · 몸 ${(bodies / t.frames).toFixed(1)}마리 ·` +
          ` 그중 서 있는 것 ${(sum(t.alive) / t.frames).toFixed(1)})`,
      );
      for (const { kind, name } of KINDS) {
        const alive = t.alive.get(kind) ?? 0;
        const down = t.down.get(kind) ?? 0;
        if (alive + down === 0) continue;
        console.log(
          `    ${name}: 몸 ${((alive + down) / t.frames).toFixed(2)}마리` +
            ` · 서 있는 몫 ${share(alive, sum(t.alive))}` +
            ` · 누운 시간 ${share(down, alive + down)}` +
            ` · 자동 조준 ${share(t.aimed.get(kind) ?? 0, aimedTotal)}`,
        );
      }
    }
    const ends = KINDS.map(({ name, kind }) => `${name} ${((atEnd.get(kind) ?? 0) / matches).toFixed(1)}`);
    console.log(`  판이 끝난 순간의 몸(판당 평균): ${ends.join(' · ')}\n`);
  });

  /**
   * **일곱은 끝까지 있다.** 이 검사가 지키는 것은 밸런스가 아니라 **위 주석의 사실**이다 —
   * 쓰러진 적이 판에서 사라지게 되는 날(예: 증원과 부활을 하나로 합치는 식으로) 여기가 먼저
   * 운다. 그때 STATUS의 '일곱 중 셋' 항목을 다시 읽어야 한다.
   *
   * 씨앗을 여덟만 쓰는 이유: 위 표와 달리 이건 **세는 것이 아니라 못 박는 것**이라
   * 표본이 클 필요가 없다(한 판이라도 종류가 사라지면 그 자리에서 거짓이다).
   */
  it('일곱은 끝까지 있다 — 쓰러진 적은 사라지지 않고 3.6초 뒤 같은 종류로 다시 선다', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const world = new World({ seed, map: DEFAULT_MAP });
      play(world, Math.round(60 * CAP), walkToNearestCore, takeAny);
      for (const { kind, name } of KINDS) {
        const bodies = world.enemies.filter((e) => e.kind === kind).length;
        expect(bodies, `씨앗 ${seed}: 판이 끝났을 때 ${name}이(가) 하나도 없다`).toBeGreaterThan(0);
      }
    }
  });
});
