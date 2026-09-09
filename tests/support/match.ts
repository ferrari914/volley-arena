import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import { ENEMY, PLAYER } from '../../src/data/config';
import type { UpgradeChoice, XpCore } from '../../src/entities/types';

/** 한 스텝의 길이(s). 게임 루프와 같은 60fps. */
export const DT = 1 / 60;

/** 손을 대지 않은 프레임. 이동도 조준도 없다. */
export const IDLE: FrameInput = { move: { x: 0, y: 0 }, aim: null };

/**
 * 카드가 떴을 때 **무엇을 고르는 사람인가.** 고른 카드의 id를 돌려준다.
 *
 * 판을 재는 자는 사람 하나가 아니라 둘이다 — **어떻게 움직이는가**(`input`)와
 * **어떻게 고르는가**(여기). 세션 16~19가 밸런스를 흔들 때마다 이 두 번째 자를
 * 그 자리에서 새로 짜고 재고 지웠고, 지운 뒤에는 그 수치를 다시 낼 방법이 없었다.
 * 그래서 자를 여기에 못 박아 둔다(`tests/perf/balance.perf.ts`가 셋을 한 표본으로 묶어 잰다).
 */
export type Chooser = (choices: readonly UpgradeChoice[], world: World) => string;

/**
 * 아무거나 고르는 사람. **첫 장을 고르는 것이 곧 아무거나 고르는 것이다** —
 * 세션 17이 카드가 서는 자리를 섞었으므로(`rollUpgradeChoices`) 첫 칸에 무엇이
 * 서는지가 판마다 굴러간다. 그 전까지는 화력이 늘 왼쪽에 섰다.
 */
export const takeAny: Chooser = (choices) => choices[0]?.card.id ?? '';

/** 화력을 먼저 고르는 사람. 없으면 남은 것 중 첫 장. 판이 가장 길게 자라는 쪽이다. */
export const preferPower: Chooser = (choices) =>
  (choices.find((c) => c.card.role === 'power') ?? choices[0])?.card.id ?? '';

/**
 * 보조를 먼저 고르는 사람. 화력이 가장 약하게 자라는 쪽 — **아래쪽 꼬리를 만드는 사람**이다.
 * `UPGRADE.maxSupport`가 한 번에 보조를 한 장까지로 막으므로 이 사람도 결국 화력을 고르게 된다.
 * (세션 17은 여기에 '무작위로 고르는 사람'을 뒀지만, 자리를 섞은 뒤로는 `takeAny`와 같은 사람이다.)
 */
export const preferSupport: Chooser = (choices) =>
  (choices.find((c) => c.card.role === 'support') ?? choices[0])?.card.id ?? '';

/**
 * 한 판을 돌린다. 카드가 떠 있으면 `choose`가 한 장을 고른다 —
 * 실제로 하는 사람도 골라야 게임이 다시 흐른다. 고르지 않으면 World는 멈춘 채로 남고,
 * 그 뒤의 측정은 "아무 일도 일어나지 않은 판"을 재게 된다.
 *
 * 쓰러지면 거기서 판이 끝난다(5번). 더 돌려도 step()이 빈 함수라 시간만 버린다.
 */
export function play(
  world: World,
  steps: number,
  input: (w: World) => FrameInput,
  choose: Chooser = takeAny,
): void {
  for (let i = 0; i < steps; i += 1) {
    if (world.defeated) return;
    const offer = world.offer;
    if (offer) {
      // 고를 수 없는 id를 돌려주면 게임이 멈춘 채로 남고, 그 뒤의 측정은 전부 거짓이 된다.
      // 조용히 넘기지 않고 여기서 세운다.
      const id = choose(offer.choices, world);
      if (!world.chooseUpgrade(id))
        throw new Error(`고르는 사람이 없는 카드를 골랐다: ${JSON.stringify(id)}`);
    }
    world.step(input(world), DT);
  }
}

/** 가장 가까운 코어로 걸어가는 사람. 실제로 하는 사람이 하는 행동이다. */
export function walkToNearestCore(world: World): FrameInput {
  let best: XpCore | null = null;
  let bestDist = Infinity;
  for (const core of world.cores) {
    if (!core.alive) continue;
    const d = Math.hypot(core.pos.x - world.player.pos.x, core.pos.y - world.player.pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = core;
    }
  }
  if (!best || bestDist < 1e-6) return IDLE;
  return {
    move: {
      x: (best.pos.x - world.player.pos.x) / bestDist,
      y: (best.pos.y - world.player.pos.y) / bestDist,
    },
    aim: null,
  };
}

/**
 * 달려드는 돌진형의 직선에서 옆으로 비키는 사람. 그것 말고는 `walkToNearestCore`와 같다.
 *
 * **DESIGN 9번이 돌진형에게 요구하는 단 하나의 대응이 이것이다** —
 * "옆으로 비키면 빗나가고, 뒤로 달아나는 것만으로는 못 피한다".
 * `walkToNearestCore`는 코어만 보고 걷느라 이 한 가지를 하지 않는다.
 * 그래서 그 사람이 재는 한 판 길이의 **아래쪽 꼬리는 게임의 성질이 아니라 그 사람의 버릇**이다
 * (세션 18에 쟀다: 몸통 한 대가 12점이라 두세 대면 판이 100초씩 짧아진다).
 *
 * **몸을 던진 뒤(`dashTimer > 0`)에만 반응한다.** 웅크리는 동안 비켜도 소용이 없다 —
 * 돌진 방향은 튀어나가는 순간에 정해지고 그때까지 몸이 따라 돈다(`systems/enemyAi.ts`).
 * 화면에 보이는 것(달려오는 몸과 그 방향)만 보고 판단하므로, 사람이 할 수 없는 일을 하지 않는다.
 */
export function dodgeCharger(world: World): FrameInput {
  const contactRadius = ENEMY.radius + PLAYER.radius;
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.kind !== 'charger' || enemy.dashTimer <= 0) continue;
    const ahead = { x: Math.cos(enemy.facing), y: Math.sin(enemy.facing) };
    const dx = world.player.pos.x - enemy.pos.x;
    const dy = world.player.pos.y - enemy.pos.y;
    // 이미 지나갔으면 비킬 것이 없다.
    if (dx * ahead.x + dy * ahead.y < 0) continue;
    // 직선에서 옆으로 얼마나 벗어나 있는가. 넉넉히 벗어나 있으면 어차피 빗나간다.
    const side = dx * -ahead.y + dy * ahead.x;
    if (Math.abs(side) > contactRadius + 0.6) continue;
    const sign = side >= 0 ? 1 : -1;
    return { move: { x: -ahead.y * sign, y: ahead.x * sign }, aim: null };
  }
  return walkToNearestCore(world);
}

/** 한 판을 끝까지 돌리고 남은 것. 씨앗 하나에 판 하나다. */
export interface MatchResult {
  seed: number;
  /** 쓰러질 때까지 걸린 시간(s). 끝까지 살아남았으면 돌린 시간 그대로. */
  elapsed: number;
  /** 그 안에 쓰러졌는가. false면 판이 제한 시간 안에 끝나지 않은 것이다. */
  defeated: boolean;
  level: number;
  kills: number;
  /** 고른 카드 id를 고른 순서대로. */
  cards: readonly string[];
  /** 돌진형의 몸에 닿힌 횟수. 한 대가 12점이라 판 길이를 가장 크게 흔든다. */
  bodyHits: number;
  /**
   * 체력이 처음 줄어든 시각(s). 한 번도 안 맞았으면 Infinity.
   * **판의 첫머리를 재는 값이다** — 손을 대기도 전에 맞으면 무엇에 맞았는지 알 수 없다
   * (DESIGN 품질 기준의 "설명 없이 30초 안에 이해할 것", `ENEMY.startDelay`).
   */
  firstHit: number;
}

/**
 * 씨앗 하나로 한 판을 끝까지 돌린다.
 *
 * **씨앗을 바꾸면 판이 통째로 달라진다.** World의 난수 하나가 코어 자리·드롭·
 * 뽑히는 카드를 모두 굴리기 때문에, 씨앗이 다르면 고른 카드의 순서가 갈리고
 * 한 판 길이가 실측 133~416초까지 흔들린다(세션 15에 잼).
 * 그래서 한 판 길이는 씨앗 하나가 아니라 여러 판의 중앙값으로 판단한다.
 */
export function playMatch(
  seed: number,
  maxSeconds = 600,
  /**
   * 어떻게 움직이는 사람인가. 기본값은 코어만 보고 걷는 사람이다 —
   * **이 자를 바꾸면 지금까지 잰 수치와 견줄 수 없게 되므로 기본값은 옮기지 않는다.**
   * 다른 사람을 재고 싶으면 여기에 넣어 나란히 재라(`dodgeCharger`).
   */
  input: (world: World) => FrameInput = walkToNearestCore,
  /** 어떻게 고르는 사람인가. 기본값은 아무거나 고르는 사람이다 — 위와 같은 이유로 옮기지 않는다. */
  choose: Chooser = takeAny,
): MatchResult {
  const world = new World({ seed });
  // 한 스텝씩 돌리며 체력이 처음 줄어드는 순간을 잡는다. `play`를 그대로 쓰는 이유:
  // 카드를 고르는 규칙이 두 벌이 되면 두 자가 서로 다른 사람을 재게 된다.
  let firstHit = Infinity;
  const steps = Math.round(60 * maxSeconds);
  for (let i = 0; i < steps && !world.defeated; i += 1) {
    const hp = world.player.hp;
    play(world, 1, input, choose);
    if (firstHit === Infinity && world.player.hp < hp) firstHit = world.elapsed;
  }
  return {
    seed,
    elapsed: world.elapsed,
    defeated: world.defeated,
    level: world.progress.level,
    kills: world.kills,
    cards: [...world.takenUpgrades],
    bodyHits: world.bodyHits,
    firstHit,
  };
}

/** 정렬된 표본에서 분위수 하나. 표본이 적으므로 보간하지 않고 가까운 자리를 고른다. */
export function quantile(sorted: readonly number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index] ?? 0;
}

/** 중앙값. 짝수 개면 가운데 둘의 평균 — 표본이 스무 개라 한쪽으로 치우치지 않게 한다. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
