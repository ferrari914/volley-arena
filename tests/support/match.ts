import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import type { XpCore } from '../../src/entities/types';

/** 한 스텝의 길이(s). 게임 루프와 같은 60fps. */
export const DT = 1 / 60;

/** 손을 대지 않은 프레임. 이동도 조준도 없다. */
export const IDLE: FrameInput = { move: { x: 0, y: 0 }, aim: null };

/**
 * 한 판을 돌린다. 카드가 떠 있으면 첫 장을 고른다 —
 * 실제로 하는 사람도 골라야 게임이 다시 흐른다. 고르지 않으면 World는 멈춘 채로 남고,
 * 그 뒤의 측정은 "아무 일도 일어나지 않은 판"을 재게 된다.
 *
 * 쓰러지면 거기서 판이 끝난다(5번). 더 돌려도 step()이 빈 함수라 시간만 버린다.
 */
export function play(world: World, steps: number, input: (w: World) => FrameInput): void {
  for (let i = 0; i < steps; i += 1) {
    if (world.defeated) return;
    const first = world.offer?.choices[0];
    if (first) world.chooseUpgrade(first.card.id);
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
}

/**
 * 씨앗 하나로 한 판을 끝까지 돌린다.
 *
 * **씨앗을 바꾸면 판이 통째로 달라진다.** World의 난수 하나가 코어 자리·드롭·
 * 뽑히는 카드를 모두 굴리기 때문에, 씨앗이 다르면 고른 카드의 순서가 갈리고
 * 한 판 길이가 실측 133~416초까지 흔들린다(세션 15에 잼).
 * 그래서 한 판 길이는 씨앗 하나가 아니라 여러 판의 중앙값으로 판단한다.
 */
export function playMatch(seed: number, maxSeconds = 600): MatchResult {
  const world = new World({ seed });
  play(world, Math.round(60 * maxSeconds), walkToNearestCore);
  return {
    seed,
    elapsed: world.elapsed,
    defeated: world.defeated,
    level: world.progress.level,
    kills: world.kills,
    cards: [...world.takenUpgrades],
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
