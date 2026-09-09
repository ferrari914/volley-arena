import type { PlayerStats, UpgradeCard, UpgradeChoice } from '../entities/types';

/** 지금까지 고른 횟수를 카드 id로 센 것. */
export type UpgradeStacks = Readonly<Record<string, number>>;

/**
 * 카드 하나를 능력치에 반영한 새 묶음을 돌려준다. 원래 값은 건드리지 않는다 —
 * 순수 함수라야 테스트가 "이 카드가 무엇을 바꾸는가"만 따로 볼 수 있다.
 *
 * 곱셈을 먼저, 덧셈을 나중에 한다. 한 카드가 둘을 함께 쓰는 일은 아직 없지만,
 * 순서를 정해 두지 않으면 나중에 그런 카드가 생겼을 때 결과가 조용히 달라진다.
 */
export function applyUpgrade(stats: PlayerStats, card: UpgradeCard): PlayerStats {
  const next: PlayerStats = { ...stats };
  for (const [key, factor] of Object.entries(card.multiply ?? {}) as [
    keyof PlayerStats,
    number,
  ][]) {
    next[key] = next[key] * factor;
  }
  for (const [key, amount] of Object.entries(card.add ?? {}) as [keyof PlayerStats, number][]) {
    next[key] = next[key] + amount;
  }
  return next;
}

/**
 * 이번 레벨업에 보여 줄 카드를 고른다.
 *
 * - 이미 최대까지 고른 카드는 빠진다. 고를 수 없는 카드를 보여 주면 선택이 아니다.
 * - 같은 카드가 두 번 나오지 않는다. 3중 1택인데 두 장이 같으면 사실상 2중 1택이다.
 * - 남은 종류가 `count`보다 적으면 있는 만큼만 돌려준다. 억지로 채우지 않는다.
 *
 * 난수는 밖에서 받는다 — World가 씨앗 고정 난수를 쓰므로 같은 판은 늘 같은 카드가 나온다
 * (성능 측정과 테스트가 같은 장면을 봐야 한다).
 */
export function rollUpgradeChoices(
  cards: readonly UpgradeCard[],
  stacks: UpgradeStacks,
  count: number,
  random: () => number,
): UpgradeChoice[] {
  const pool = cards.filter((card) => (stacks[card.id] ?? 0) < card.maxStacks);

  // 앞에서부터 필요한 만큼만 섞는다(부분 피셔-예이츠). 목록이 길어져도 비용이 count에 비례한다.
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    const a = pool[i];
    const b = pool[j];
    if (a && b) {
      pool[i] = b;
      pool[j] = a;
    }
  }

  return pool.slice(0, take).map((card) => ({ card, stacks: stacks[card.id] ?? 0 }));
}
