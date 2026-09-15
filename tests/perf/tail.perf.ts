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
 * **아래쪽 꼬리를 재는 표 — 세 사람 × 씨앗 480개 (세션 55).**
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
 * 함께 재는 것 — **아홉째 장이 화력 자리를 먹었는가**(세션 53이 의심한 길).
 * 걷는 사람이 고른 카드 중 화력의 몫은 65.8% → 64.6%로, 1.2%p밖에 안 움직인다.
 * 그럴 수밖에 없다: **한 번에 섞이는 보조는 `UPGRADE.maxSupport`장까지**라
 * 보조 카드가 늘어도 한 벌에 서는 보조의 **수**는 그대로고, 그 한 자리에 **어느 보조가
 * 서는가**만 바뀐다. 남은 1.2%p는 화력이 동나 보조로 채운 자리의 몫이다
 * (`systems/upgrades.ts`의 두 번째 채우기 — 관통·튕김·다중 발사는 두 장이 상한이다).
 *
 * **그래서 세션 55는 아무 값도 바꾸지 않았다.** `maxSupport`도 `repel`의 역할도 그대로다.
 *
 * `npm test`가 아니라 `npm run perf`에 두는 이유는 `balance.perf.ts`와 같다 — 느리다
 * (1920판 · 이 기계에서 20초). 매 바퀴 지키는 문턱은 `tests/progression.test.ts`에 있고,
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

/**
 * 한 사람의 480판. **판을 `SHORTEST`에서 끊는다** — 재는 것이 "그 선 아래인가"뿐이라
 * 그 뒤는 볼 필요가 없고, 끊지 않으면 이 표 하나가 1분을 넘는다.
 */
function tailSeeds(input: (world: World) => FrameInput): number[] {
  return SEEDS.filter((seed) => playMatch(seed, SHORTEST, input).defeated);
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

const roleOf = new Map(UPGRADE_CARDS.map((card) => [card.id, card.role]));

/** 고른 카드 중 화력의 몫. **보조 카드를 늘리는 바퀴가 보는 값이다**(위 주석). */
function powerShare(input: (world: World) => FrameInput): {
  total: number;
  power: number;
  perMatch: number;
} {
  let total = 0;
  let power = 0;
  for (const seed of SEEDS) {
    for (const id of playMatch(seed, SHORTEST, input).cards) {
      total += 1;
      if (roleOf.get(id) === 'power') power += 1;
    }
  }
  return { total, power, perMatch: total / SEEDS.length };
}

describe(`아래쪽 꼬리 — 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  it('꼬리는 아무 답도 모르는 사람에게만 있다', () => {
    const rows = PEOPLE.map((p) => {
      const dead = tailSeeds(p.input);
      return { name: p.name, dead, blocks: byBlock(dead) };
    });
    const plain = rows[0]?.dead.length ?? 0;
    const share = powerShare(walkToNearestCore);

    console.log(
      [
        '',
        `  씨앗 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} · ${SEEDS.length}판 · ${SHORTEST}초에서 끊는다`,
        `  카드 ${UPGRADE_CARDS.length}장`,
        '',
        ...rows.map(
          (r) =>
            `  ${r.name.padEnd(7, ' ')} ${String(r.dead.length).padStart(3, ' ')}/${SEEDS.length}판 ` +
            `(${((r.dead.length / SEEDS.length) * 100).toFixed(1)}% · 1σ ${sigma(r.dead.length, SEEDS.length).toFixed(1)}%p) · ` +
            `${BLOCK}판씩: ${r.blocks.join(' / ')}`,
        ),
        '',
        `  걷는 사람이 고른 카드 ${share.total}장 · 화력 ${share.power}장 ` +
          `(${((share.power / share.total) * 100).toFixed(1)}%) · 판당 ${share.perMatch.toFixed(2)}장`,
        '',
      ].join('\n'),
    );

    // 아래 선들은 실측에서 넉넉히 물러나 잡았다(`balance.perf.ts`와 같은 규칙) —
    // 이 표는 값을 고르는 자이지 매 바퀴 지키는 문턱이 아니다.

    // ① 아무 답도 모르는 사람에게는 꼬리가 있다(실측 39/480 · 8.1%).
    // 없으면 적이 아무것도 묻지 않고 있다는 뜻이다.
    expect(plain, '걷는 사람의 꼬리').toBeGreaterThanOrEqual(20);

    // ② 답을 아는 두 사람에게는 사실상 없다(실측 0 · 7/480). 꼬리가 버릇이 아니라
    // 게임의 성질이 되면 여기가 먼저 운다 — 그때는 밸런스를 볼 자리가 있다는 뜻이다.
    for (const r of rows.slice(1)) {
      expect(r.dead.length * 4, `${r.name} ${r.dead.length}판 · 걷는 사람 ${plain}판`).toBeLessThan(
        plain,
      );
    }

    // ③ 화력이 고른 카드의 절반을 넘는다(실측 64.6%). `UPGRADE.maxSupport`가 지키는 선이고,
    // 보조 카드를 늘리는 바퀴가 깨뜨리기 쉬운 선이다 — 깨지면 3중 1택이 보조 고르기가 된다.
    expect(share.power / share.total, '고른 카드 중 화력의 몫').toBeGreaterThan(0.55);
  });
});
