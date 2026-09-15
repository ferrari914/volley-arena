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

/** 목록을 제자리에서 섞는다(피셔-예이츠). 아홉 장짜리 목록이라 전부 섞어도 값이 싸다. */
function shuffle(list: UpgradeCard[], random: () => number): void {
  for (let i = 0; i < list.length - 1; i += 1) {
    const j = i + Math.floor(random() * (list.length - i));
    const a = list[i];
    const b = list[j];
    if (a && b) {
      list[i] = b;
      list[j] = a;
    }
  }
}

/**
 * 이번 레벨업에 보여 줄 카드를 고른다.
 *
 * - 이미 최대까지 고른 카드는 빠진다. 고를 수 없는 카드를 보여 주면 선택이 아니다.
 * - **체력이 가득 차 있으면 회복 카드도 같은 이유로 빠진다**(`wounded`).
 *   되돌릴 체력이 없는 회복은 골라도 아무 일이 없어, 3중 1택이 사실상 2중 1택이 된다.
 * - **보조 카드는 한 번에 `maxSupport`장까지만 섞인다**(아래 설명).
 * - 같은 카드가 두 번 나오지 않는다. 3중 1택인데 두 장이 같으면 사실상 2중 1택이다.
 * - 남은 종류가 `count`보다 적으면 있는 만큼만 돌려준다. 억지로 채우지 않는다.
 * - **돌려주는 순서도 섞는다.** 안 섞으면 화력 카드가 늘 왼쪽에 서서
 *   어느 자리가 센 카드인지가 읽기 전에 보인다.
 *
 * 난수는 밖에서 받는다 — World가 씨앗 고정 난수를 쓰므로 같은 판은 늘 같은 카드가 나온다
 * (성능 측정과 테스트가 같은 장면을 봐야 한다).
 */
export function rollUpgradeChoices(
  cards: readonly UpgradeCard[],
  stacks: UpgradeStacks,
  count: number,
  random: () => number,
  /**
   * 지금 되돌릴 체력이 있는가. 적지 않으면 있는 것으로 본다 —
   * 회복 카드가 없던 시절의 부름(테스트 포함)이 뜻을 바꾸지 않게 한다.
   */
  wounded = true,
  /**
   * 한 번에 섞이는 보조(`role: 'support'`) 카드의 최대 장수.
   * 적지 않으면 막지 않는다 — 이 규칙이 없던 시절의 부름이 뜻을 바꾸지 않게 한다.
   * 실제 값은 `UPGRADE.maxSupport`에 있고, 왜 그 값인지도 거기 적어 두었다.
   */
  maxSupport = Infinity,
): UpgradeChoice[] {
  const pool = cards.filter(
    (card) => (stacks[card.id] ?? 0) < card.maxStacks && (wounded || card.heal === undefined),
  );
  shuffle(pool, random);

  const take = Math.min(count, pool.length);
  const picked: UpgradeCard[] = [];
  let support = 0;
  for (const card of pool) {
    if (picked.length >= take) break;
    if (card.role === 'support' && support >= maxSupport) continue;
    picked.push(card);
    if (card.role === 'support') support += 1;
  }
  // 화력 카드가 동나 자리가 남으면(관통·튕김·다중 발사는 두 장이 상한이다) 보조로 채운다.
  // 상한 때문에 두 장만 보여 주면 3중 1택이 2중 1택이 된다 — 막으려던 것과 같은 고장이다.
  for (const card of pool) {
    if (picked.length >= take) break;
    if (!picked.includes(card)) picked.push(card);
  }
  shuffle(picked, random);

  return picked.map((card) => ({ card, stacks: stacks[card.id] ?? 0 }));
}
