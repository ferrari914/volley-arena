import { describe, expect, it } from 'vitest';
import type { FrameInput, World } from '../../src/core/World';
import { UPGRADE_CARDS } from '../../src/data/upgrades';
import {
  backOffBomber,
  circleShield,
  dodgeCharger,
  playMatch,
  walkToNearestCore,
} from '../support/match';

/**
 * **아래쪽 꼬리를 재는 표 — 세 사람 × 씨앗 480개 (세션 55 · 58).**
 *
 * 왜 따로 있나: **`npm test`의 120판으로는 카드 한 장의 몫을 가를 수 없다.**
 * 세션 53이 밀어내기(`repel`)를 넣으며 120판으로 재고 "걷는 사람의 꼬리가 9 → 16으로
 * 두 배 가까이 늘었다"를 STATUS에 숙제로 남겼다. 같은 자를 480판으로 넓혀 다시 재니
 * **42 → 39로 오히려 줄었다.** 9 → 16은 게임이 아니라 **씨앗 창문 하나의 운**이었다 —
 * 120판씩 네 토막으로 끊어 보면 한눈에 보인다:
 *
 * | 150초 안에 쓰러진 판 (걷는 사람) | 1~120 | 121~240 | 241~360 | 361~480 | 모두 |
 * |---|---|---|---|---|---|
 * | 카드 넣기 전(여덟 장) | 9 | 11 | 9 | 13 | **42** (8.8%) |
 * | 카드 넣은 뒤(아홉 장) | **16** | 8 | 8 | 7 | **39** (8.1%) |
 *
 * 세션 53이 본 것은 맨 왼쪽 칸 하나다. 나머지 세 칸은 전부 반대로 움직였다.
 * 비율 8%대에서 120판의 1σ는 2.5%p(=3판)이고 두 값의 차는 그 √2배라,
 * **120판으로 갈리는 것은 7%p(9판)보다 큰 차이뿐이다.** 카드 한 장이 그만큼 흔드는 일은 없다.
 * 480판이면 1σ가 1.2%p라 3.5%p(17판)쯤부터 읽힌다 — 이 표가 가르는 것도 그 위쪽뿐이다.
 *
 * ---
 *
 * **세션 58이 여기에 더한 것 — 이 표는 "무엇이 흔들렸나"까지 찍는다.**
 *
 * 열째 장(`backstep` 뒷걸음 · 세션 57)이 들어오자 ②가 울었다. 갈라 보니 원인이
 * 카드가 **하는 일**이 아니라 카드가 **하나 더 있다는 것**이었다. 같은 480판을 세 번 돌렸다:
 *
 * | 150초 안에 쓰러진 판 | 걷는 사람 | 비키는 사람 | 도는 사람 |
 * |---|---|---|---|
 * | 아홉 장 | 39 | 0 | 7 |
 * | 열 장 — 효과를 0으로 죽인 채(자리만 차지) | **44** | 1 | **15** |
 * | 열 장 — 실제 값(0.25) | 37 | 1 | 13 |
 *
 * **아무것도 안 하는 카드를 한 장 끼우는 것만으로 꼬리가 늘었다.** `UPGRADE.maxSupport`가
 * 1이라 한 벌에 서는 보조는 늘 한 장인데, 그 한 자리를 다투는 보조 카드가 여섯이 됐다.
 * 그래서 **보조 한 장의 몫이 7%대에서 6%대로 내려간다** — 도는 사람이 고른 카드 중
 * 회복은 5.5% → 5.0%, 질주는 7.3% → 6.1%다. 그 자리를 새 장이 5.9% 가져가는데
 * **도는 사람에게 그 장은 거의 안 듣는다**(겨눈 쪽에서 물러나는 일이 드문 발이다).
 * 판당 고르는 열두 장 중 0.7장이 그 사람에게는 빈 장이 된 셈이다. 피하며 버티는 사람은
 * 보조로 버티므로 먼저 운다. 카드 자체가 하는 일은 오히려 양쪽을 도왔다(44 → 37 · 15 → 13).
 *
 * 세션 55가 보던 **화력의 몫은 이 변화를 못 본다** — 64.6% → 64.3%. 그럴 수밖에 없다.
 * `maxSupport`가 보조의 **수**를 못 박으므로 늘어나는 것은 **그 한 자리에 어느 보조가
 * 서는가**뿐이다. 그래서 이 표는 이제 **고른 카드의 속을 사람마다 찍는다**(아래 `composition`).
 * 보조 카드를 늘리는 바퀴가 실제로 봐야 하는 값은 화력 몫이 아니라 그 속이다.
 *
 * `npm test`가 아니라 `npm run perf`에 두는 이유는 `balance.perf.ts`와 같다 — 느리다
 * (1440판 · 이 기계에서 25초). 매 바퀴 지키는 문턱은 `tests/progression.test.ts`에 있고,
 * 거기는 **꼬리가 있는지**(큰 차이)만 본다. 여기는 **꼬리가 얼마나 되는지**(작은 차이)를 잰다.
 * 카드나 적을 넣고 빼는 바퀴는 넣기 전후로 이 표를 돌려 나란히 놓아라.
 */
const SEEDS = Array.from({ length: 480 }, (_, i) => 20260909 + i);

/** `tests/progression.test.ts`와 같은 선. 두 표가 같은 자를 써야 견줄 수 있다. */
const SHORTEST = 150;
/** 네 토막으로 끊어 보는 크기. `npm test`가 쓰는 씨앗 수와 같다 — 그 창문의 운을 눈으로 보려고. */
const BLOCK = 120;

/**
 * 세 사람. `tests/progression.test.ts`의 세 사람과 같은 발이다.
 * 맨 위가 **아무 답도 모르는 사람**이고, 꼬리를 재는 자리는 늘 그 사람이다.
 */
const PEOPLE: readonly { name: string; input: (world: World) => FrameInput }[] = [
  { name: '걷는 사람', input: walkToNearestCore },
  { name: '비키는 사람', input: backOffBomber(dodgeCharger) },
  { name: '도는 사람', input: backOffBomber(circleShield) },
];

const roleOf = new Map(UPGRADE_CARDS.map((card) => [card.id, card.role]));

interface Run {
  name: string;
  /** 150초 안에 쓰러진 씨앗. **판을 `SHORTEST`에서 끊는다** — 재는 것이 "그 선 아래인가"뿐이다. */
  dead: number[];
  blocks: number[];
  /** 그 480판에서 고른 카드. 속까지 센다 — 위 주석의 '무엇이 흔들렸나'가 여기서 나온다. */
  cards: number;
  power: number;
  byCard: Map<string, number>;
}

/**
 * 한 사람의 480판. 꼬리와 고른 카드를 **한 번에** 센다.
 *
 * 세션 55는 꼬리를 재는 길과 카드를 세는 길을 따로 돌려 480판을 한 번 더 걸었다.
 * 같은 씨앗·같은 발·같은 자리라 결과가 같을 수밖에 없는 판을 두 번 돌린 셈이다
 * (그때 잰 5862장·64.6%가 이 길에서도 그대로 나온다).
 */
function runPerson(name: string, input: (world: World) => FrameInput): Run {
  const dead: number[] = [];
  const byCard = new Map<string, number>();
  let cards = 0;
  let power = 0;
  for (const seed of SEEDS) {
    const result = playMatch(seed, SHORTEST, input);
    if (result.defeated) dead.push(seed);
    for (const id of result.cards) {
      cards += 1;
      if (roleOf.get(id) === 'power') power += 1;
      byCard.set(id, (byCard.get(id) ?? 0) + 1);
    }
  }
  return { name, dead, blocks: byBlock(dead), cards, power, byCard };
}

/** 120씩 네 토막으로 끊어 센다. 한 창문의 운이 표 전체로 읽히는 것을 막는 자다. */
function byBlock(dead: readonly number[]): number[] {
  const blocks = Math.ceil(SEEDS.length / BLOCK);
  return Array.from(
    { length: blocks },
    (_, b) =>
      dead.filter(
        (seed) =>
          seed >= (SEEDS[b * BLOCK] ?? Infinity) &&
          seed <= (SEEDS[Math.min((b + 1) * BLOCK, SEEDS.length) - 1] ?? -Infinity),
      ).length,
  );
}

/** 표본 비율의 1σ(%p). "이 표로 갈리는 차이가 얼마부터인가"를 표에 함께 적는다. */
const sigma = (count: number, n: number): number => {
  const p = count / n;
  return Math.sqrt((p * (1 - p)) / n) * 100;
};

/** 고른 카드의 속. **보조 카드를 늘리는 바퀴가 보는 줄이다**(위 주석). */
function composition(run: Run): string {
  const share = (n: number): string => `${((n / run.cards) * 100).toFixed(1)}%`;
  const support = UPGRADE_CARDS.filter((card) => card.role === 'support')
    .map((card) => ({ id: card.id, n: run.byCard.get(card.id) ?? 0 }))
    .sort((a, b) => b.n - a.n)
    .map((c) => `${c.id} ${share(c.n)}`)
    .join(' · ');
  return (
    `  ${run.name.padEnd(7, ' ')} ${String(run.cards).padStart(4, ' ')}장 · ` +
    `판당 ${(run.cards / SEEDS.length).toFixed(2)}장 · 화력 ${share(run.power)} · ` +
    `보조 [${support}]`
  );
}

describe(`아래쪽 꼬리 — 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  it('꼬리는 아무 답도 모르는 사람에게만 있다', () => {
    const rows = PEOPLE.map((p) => runPerson(p.name, p.input));
    const plain = rows[0]?.dead.length ?? 0;
    const knowing = rows.slice(1);

    console.log(
      [
        '',
        `  씨앗 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} · ${SEEDS.length}판 · ${SHORTEST}초에서 끊는다`,
        `  카드 ${UPGRADE_CARDS.length}장 (보조 ${UPGRADE_CARDS.filter((c) => c.role === 'support').length}장)`,
        '',
        ...rows.map(
          (r) =>
            `  ${r.name.padEnd(7, ' ')} ${String(r.dead.length).padStart(3, ' ')}/${SEEDS.length}판 ` +
            `(${((r.dead.length / SEEDS.length) * 100).toFixed(1)}% · 1σ ${sigma(r.dead.length, SEEDS.length).toFixed(1)}%p) · ` +
            `${BLOCK}판씩: ${r.blocks.join(' / ')}`,
        ),
        '',
        '  고른 카드의 속 — 보조 카드를 늘린 바퀴는 이 줄을 넣기 전후로 나란히 놓아라',
        ...rows.map(composition),
        '',
      ].join('\n'),
    );

    // 아래 선들은 실측에서 넉넉히 물러나 잡았다(`balance.perf.ts`와 같은 규칙) —
    // 이 표는 값을 고르는 자이지 매 바퀴 지키는 문턱이 아니다.

    // ① 아무 답도 모르는 사람에게는 꼬리가 있다(실측 37/480 · 7.7%).
    // 없으면 적이 아무것도 묻지 않고 있다는 뜻이다.
    expect(plain, '걷는 사람의 꼬리').toBeGreaterThanOrEqual(20);

    // ② 답을 아는 사람의 꼬리는 **모르는 사람의 절반보다 작다**(실측 1/480 · 13/480 대 37/480).
    //
    // **세션 58이 ×4에서 ×2로 물렸다.** 세션 55가 ×4를 적을 때 실측이 0과 7이었고 선은 9였다 —
    // 7의 1σ가 2.6판이라 **선이 실측에서 0.8σ밖에 안 떨어져 있었다.** ④가 걸어온 길과 같은
    // 고장이다(세션 56): 통과 여부를 씨앗 운이 정한다. 실제로 열째 장이 들어오자 울었다.
    // ×2면 도는 사람이 18판까지 버티므로 실측 13에서 1.5σ다.
    //
    // **선을 물린 것이지 값이 안 움직였다는 뜻이 아니다.** 도는 사람은 7 → 13으로 늘었고,
    // 그 까닭은 위 주석에 적힌 **보조 자리 희석**이다. 아래 ④가 그 자리를 따로 지킨다.
    for (const r of knowing) {
      expect(r.dead.length * 2, `${r.name} ${r.dead.length}판 · 걷는 사람 ${plain}판`).toBeLessThan(
        plain,
      );
    }

    // ③ 화력이 고른 카드의 절반을 넘는다(실측 64.3%). `UPGRADE.maxSupport`가 지키는 선이고,
    // 보조 카드를 늘리는 바퀴가 깨뜨리기 쉬운 선이다 — 깨지면 3중 1택이 보조 고르기가 된다.
    const plainRun = rows[0];
    expect(
      (plainRun?.power ?? 0) / (plainRun?.cards ?? 1),
      '고른 카드 중 화력의 몫',
    ).toBeGreaterThan(0.55);

    // ④ **회복이 보조 자리에서 밀려나지 않는다**(실측: 세 사람 중 가장 적게 만나는 사람이 4.4%).
    //
    // 세션 58이 새로 세운 선이다. ③(화력의 몫)은 보조 카드가 늘어도 안 움직이므로
    // **보조를 늘리는 바퀴에게 아무 말도 해 주지 않는다** — `maxSupport`가 보조의 수를
    // 못 박기 때문이다. 실제로 움직이는 것은 그 한 자리의 **속**이고, 그중 판 길이를
    // 가장 곧바로 쥐고 있는 것이 회복이다. 열째 장이 들어오며 5.5~5.9% → 4.4~5.4%로 내려갔다.
    //
    // **세 사람 중 가장 낮은 값으로 잰다.** 한 사람만 보면 다음 카드가 다른 사람의 회복을
    // 깎을 때 조용하다. 선은 3.5% — 실측 최소 4.4%에서 3σ 넘게 물러난 자리다(5887장 중
    // 259장이라 1σ가 0.27%p이고, 여기까지 0.9%p다). 여기가 울면 **보조 카드가 너무 많아져 회복을 못 만나는 것**이다.
    // 그때 고를 것은 선을 또 물리는 일이 아니라, 카드를 빼거나 `UPGRADE.maxSupport`를
    // 다시 재는 일이다.
    const mendShare = rows.map((r) => (r.byCard.get('mend') ?? 0) / r.cards);
    expect(Math.min(...mendShare), '고른 카드 중 회복의 몫 — 세 사람 중 최소').toBeGreaterThan(
      0.035,
    );
  });
});
