import { describe, expect, it } from 'vitest';
import { World, type FrameInput } from '../src/core/World';
import { ARROW, LEVEL, PLAYER, UPGRADE } from '../src/data/config';
import { UPGRADE_CARDS } from '../src/data/upgrades';
import {
  createXpCore,
  type PlayerStats,
  type UpgradeCard,
  type UpgradeRole,
} from '../src/entities/types';
import { applyUpgrade, rollUpgradeChoices } from '../src/systems/upgrades';
import { healPlayer } from '../src/systems/combat';
import { xpForLevel } from '../src/systems/experience';
import { walkToNearestCore } from './support/match';

const DT = 1 / 60;
const IDLE: FrameInput = { move: { x: 0, y: 0 }, aim: null };

/** 씨앗 고정 난수. 테스트도 바퀴마다 같은 카드를 봐야 한다. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 카드를 적용해 볼 능력치 한 벌. 값이 하나 늘 때 고칠 자리를 여기 한 곳으로 둔다. */
const baseStats = (): PlayerStats => ({
  fireCooldown: 0.4,
  moveSpeed: 7,
  magnetRadius: 4,
  xpMultiplier: 1,
  arrowCount: 1,
  pierce: 0,
  bounce: 0,
  knockback: 0,
  backstep: 0,
  burstRadius: 0,
});

const card = (id: string, maxStacks = 3, role: UpgradeRole = 'power'): UpgradeCard => ({
  id,
  title: id,
  detail: '',
  role,
  maxStacks,
  accent: '#fff',
  multiply: { moveSpeed: 1.1 },
});

/** 플레이어 발밑에 코어를 놓아 다음 스텝에 그만큼의 경험치를 준다. */
function feedXp(world: World, amount: number): void {
  world.cores.push(createXpCore(9000 + world.cores.length, world.player.pos, amount, 'drop', 10));
  world.step(IDLE, DT);
}

/** 지금 떠 있는 카드 중 첫 장을 고른다. */
function pickFirst(world: World): string {
  const first = world.offer?.choices[0];
  if (!first) throw new Error('카드가 떠 있지 않다');
  world.chooseUpgrade(first.card.id);
  return first.card.id;
}

describe('업그레이드 카드 뽑기', () => {
  it('서로 다른 카드를 정해진 장수만큼 준다', () => {
    const random = makeRandom(3);
    for (let i = 0; i < 50; i += 1) {
      const choices = rollUpgradeChoices(UPGRADE_CARDS, {}, UPGRADE.choices, random);
      expect(choices).toHaveLength(UPGRADE.choices);
      expect(new Set(choices.map((c) => c.card.id)).size).toBe(UPGRADE.choices);
    }
  });

  it('최대까지 고른 카드는 다시 나오지 않는다', () => {
    const cards = [card('a', 1), card('b', 5), card('c', 5)];
    const random = makeRandom(5);
    for (let i = 0; i < 50; i += 1) {
      const choices = rollUpgradeChoices(cards, { a: 1 }, 3, random);
      expect(choices.map((c) => c.card.id)).not.toContain('a');
      expect(choices).toHaveLength(2);
    }
  });

  it('고른 횟수를 함께 알려 준다 (카드에 몇 장째인지 표시한다)', () => {
    const choices = rollUpgradeChoices([card('a', 5)], { a: 2 }, 3, makeRandom(1));
    expect(choices[0]?.stacks).toBe(2);
  });

  it('고를 카드가 하나도 없으면 빈 목록이다', () => {
    expect(rollUpgradeChoices([card('a', 1)], { a: 1 }, 3, makeRandom(1))).toEqual([]);
  });

  it('네 종류가 모두 뽑힌다 (한 장이 영영 안 나오는 일이 없다)', () => {
    const random = makeRandom(99);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      for (const choice of rollUpgradeChoices(UPGRADE_CARDS, {}, UPGRADE.choices, random)) {
        seen.add(choice.card.id);
      }
    }
    expect(seen.size).toBe(UPGRADE_CARDS.length);
  });
});

/**
 * 석 장이 모두 보조로 뜨면 그 레벨업에는 화력을 기를 길이 없다 —
 * 화력을 기를지 말지를 고르는 사람이 아니라 뽑기가 정하게 된다.
 * 그렇게 약하게 자란 판이 3분을 못 채우고 끝나던 것이 세션 16이 남긴 아래쪽 꼬리다.
 */
describe('업그레이드 카드 뽑기 — 보조 카드 상한', () => {
  const isSupport = (id: string): boolean =>
    UPGRADE_CARDS.find((c) => c.id === id)?.role === 'support';

  it('데이터가 상한을 지킬 수 있다 (화력 카드가 채울 만큼 있다)', () => {
    // 화력이 이보다 적으면 상한이 카드 장수를 3장 밑으로 깎는다. 새 카드를 보조로만
    // 늘리면 여기서 먼저 걸린다.
    const power = UPGRADE_CARDS.filter((c) => c.role === 'power').length;
    expect(power).toBeGreaterThanOrEqual(UPGRADE.choices - UPGRADE.maxSupport);
  });

  /**
   * **보조 카드를 한 장 더 넣기 전에 세우는 자다(세션 59).**
   *
   * 상한이 1이라 한 벌에 서는 보조는 늘 한 장인데, 그 한 자리를 다투는 보조 카드는
   * 세 바퀴 연속으로 늘었다(세션 48 · 53 · 57). 자리는 그대로고 나누는 사람만 느니
   * **보조 한 장의 몫이 1/n으로 줄어든다** — 다섯 장일 때 회복의 몫이 5.5%,
   * 여섯 장인 지금 4.4%다(`tests/perf/tail.perf.ts` ④ · 세 사람 중 최소).
   * 일곱째를 넣으면 4.4 × 6/7 ≈ **3.8%**로, ④의 선(3.5%)까지 남는 폭이 1σ(0.27%p)도 안 된다.
   * 여덟째는 3.3%로 선 아래다.
   *
   * **그러니 일곱째 보조는 "재 보면 아는" 자리가 아니라 "재야만 아는" 자리다.**
   * 여기가 울면 카드를 지우라는 뜻이 아니라 **넣기 전후로 `npm run perf`를 돌려
   * ④를 나란히 놓고, 통과하면 이 수를 함께 올리라**는 뜻이다.
   *
   * **상한을 2로 여는 것은 답이 아니다** — 세션 59가 480판으로 쟀다.
   * 꼬리가 37 → 98판, 화력 몫이 64.3% → 44.4%가 된다(`data/config.ts`의 `maxSupport`).
   */
  it('보조 카드가 여섯 장을 넘지 않는다 — 넘기려면 회복의 몫부터 재라', () => {
    const support = UPGRADE_CARDS.filter((c) => c.role === 'support').length;
    expect(support, '보조 카드 수 (한 자리를 나눠 갖는 장수)').toBeLessThanOrEqual(6);
  });

  it('한 번에 상한 장수까지만 보조가 섞인다', () => {
    const random = makeRandom(7);
    for (let i = 0; i < 300; i += 1) {
      const choices = rollUpgradeChoices(
        UPGRADE_CARDS,
        {},
        UPGRADE.choices,
        random,
        true,
        UPGRADE.maxSupport,
      );
      const support = choices.filter((c) => isSupport(c.card.id)).length;
      expect(support).toBeLessThanOrEqual(UPGRADE.maxSupport);
    }
  });

  it('화력이 동나면 보조로 채운다 — 상한 때문에 두 장만 보여 주지 않는다', () => {
    // 관통·튕김·다중 발사는 두 장이 상한이라 판 후반에 실제로 동난다.
    const stacks: Record<string, number> = {};
    for (const c of UPGRADE_CARDS) if (c.role === 'power') stacks[c.id] = c.maxStacks;
    const choices = rollUpgradeChoices(
      UPGRADE_CARDS,
      stacks,
      UPGRADE.choices,
      makeRandom(11),
      true,
      UPGRADE.maxSupport,
    );
    expect(choices).toHaveLength(UPGRADE.choices);
    expect(new Set(choices.map((c) => c.card.id)).size).toBe(UPGRADE.choices);
  });

  it('적지 않으면 막지 않는다 (상한이 없던 시절의 부름이 뜻을 바꾸지 않는다)', () => {
    const only = [card('a', 9, 'support'), card('b', 9, 'support'), card('c', 9, 'support')];
    expect(rollUpgradeChoices(only, {}, 3, makeRandom(13))).toHaveLength(3);
  });

  it('한 판 내내 어느 레벨업에도 화력을 고를 길이 있다', () => {
    // 판 후반에는 화력이 동난다(관통·튕김·다중 발사는 두 장이 상한이다). 그때는 보조로
    // 채우는 것이 맞다 — 두 장짜리 3중 1택을 막으려던 것과 같은 이유다.
    // 그래서 재는 것은 "보조가 몇 장인가"가 아니라 **아직 고를 수 있는 화력이 남았는데도
    // 안 보여 주는 일이 있는가**이다.
    const world = new World({ seed: 20260909 });
    const power = UPGRADE_CARDS.filter((c) => c.role === 'power');
    let offers = 0;
    for (let i = 0; i < 60 * 300; i += 1) {
      if (world.defeated) break;
      const offer = world.offer;
      if (offer) {
        offers += 1;
        const taken = new Map<string, number>();
        for (const id of world.takenUpgrades) taken.set(id, (taken.get(id) ?? 0) + 1);
        const left = power.filter((c) => (taken.get(c.id) ?? 0) < c.maxStacks).length;
        const shown = offer.choices.filter((c) => !isSupport(c.card.id)).length;
        expect(shown, `${offer.level}레벨의 카드`).toBeGreaterThanOrEqual(
          Math.min(left, UPGRADE.choices - UPGRADE.maxSupport),
        );
      }
      if (offer) world.chooseUpgrade(offer.choices[0]!.card.id);
      world.step(walkToNearestCore(world), DT);
    }
    // 서 있으면 두 판만에 죽어 표본이 안 된다. 코어를 주우러 다니는 사람으로 돌린다.
    expect(offers).toBeGreaterThan(10);
  });

  it('카드가 서는 자리도 섞인다 — 보조가 늘 끝 칸에 있지 않다', () => {
    // 안 섞으면 어느 자리가 센 카드인지가 읽기 전에 보인다.
    // 자리마다 한 번씩은 서는지를 본다 — "늘 마지막 칸"이면 여기서 걸린다.
    const random = makeRandom(17);
    const seats = [0, 0, 0];
    for (let i = 0; i < 300; i += 1) {
      const choices = rollUpgradeChoices(
        UPGRADE_CARDS,
        {},
        UPGRADE.choices,
        random,
        true,
        UPGRADE.maxSupport,
      );
      choices.forEach((c, seat) => {
        if (isSupport(c.card.id)) seats[seat] = (seats[seat] ?? 0) + 1;
      });
    }
    for (const [seat, count] of seats.entries()) {
      expect(count, `${seat + 1}번째 칸에 선 보조 카드`).toBeGreaterThan(0);
    }
  });
});

describe('업그레이드 적용', () => {
  it('적힌 값에만 곱하고 원래 값은 건드리지 않는다', () => {
    const stats = baseStats();
    const next = applyUpgrade(stats, card('swift'));
    expect(next.moveSpeed).toBeCloseTo(7.7, 6);
    expect(next.fireCooldown).toBe(0.4);
    expect(stats.moveSpeed).toBe(7);
  });

  it('개수 카드는 곱하지 않고 더한다 (화살 1.5발은 없다)', () => {
    const stats = baseStats();
    const plus: UpgradeCard = {
      id: 'volley',
      title: 'volley',
      detail: '',
      role: 'power',
      maxStacks: 2,
      accent: '#fff',
      add: { arrowCount: 2 },
    };
    expect(applyUpgrade(stats, plus).arrowCount).toBe(3);
    expect(applyUpgrade(applyUpgrade(stats, plus), plus).arrowCount).toBe(5);
    // 적히지 않은 값은 그대로다.
    expect(applyUpgrade(stats, plus).moveSpeed).toBe(7);
  });

  it('여러 장을 겹치면 곱해서 쌓인다', () => {
    let stats = baseStats();
    stats = applyUpgrade(stats, card('swift'));
    stats = applyUpgrade(stats, card('swift'));
    expect(stats.moveSpeed).toBeCloseTo(7 * 1.1 * 1.1, 6);
  });

  it('목록의 카드는 전부 무언가를 바꾼다', () => {
    for (const c of UPGRADE_CARDS) {
      // 회복은 능력치가 아니라 몸에 닿는다 — 그것도 '무언가를 바꾸는' 한 갈래다.
      const changes =
        Object.keys(c.multiply ?? {}).length +
        Object.keys(c.add ?? {}).length +
        (c.heal ? 1 : 0);
      expect(changes).toBeGreaterThan(0);
      expect(c.maxStacks).toBeGreaterThan(0);
      expect(c.detail.length).toBeGreaterThan(0);
    }
    // id가 겹치면 고른 횟수가 뒤섞인다.
    expect(new Set(UPGRADE_CARDS.map((c) => c.id)).size).toBe(UPGRADE_CARDS.length);
  });
});

/**
 * 회복 카드 (DESIGN 8번). 다른 카드와 달리 능력치가 아니라 몸에 곧바로 닿는다 —
 * 그래서 "언제 보여 주는가"와 "얼마나 되돌리는가"를 둘 다 지켜야 한다.
 */
describe('회복 카드', () => {
  const mend = UPGRADE_CARDS.find((c) => c.id === 'mend');
  if (!mend?.heal) throw new Error('회복 카드가 없다');
  const healAmount = PLAYER.maxHp * mend.heal;

  /** 회복 카드가 뜰 때까지 레벨을 올린다. 뜬 자리에서 멈춘다(고르지 않는다). */
  function offerMend(world: World, hp: number): void {
    for (let i = 0; i < 40; i += 1) {
      world.player.hp = hp;
      if (world.offer?.choices.some((c) => c.card.id === 'mend')) return;
      // 회복이 아닌 카드를 골라 넘긴다 — 회복을 골라 버리면 상한에 닿아 다시 안 뜬다.
      const other = world.offer?.choices.find((c) => c.card.id !== 'mend');
      if (other) world.chooseUpgrade(other.card.id);
      feedXp(world, xpForLevel(world.progress.level, LEVEL));
    }
    throw new Error('회복 카드가 뜨지 않았다');
  }

  it('고르면 그 자리에서 체력이 돌아온다', () => {
    const world = new World();
    offerMend(world, 40);
    expect(world.chooseUpgrade('mend')).toBe(true);
    expect(world.player.hp).toBeCloseTo(40 + healAmount, 6);
  });

  it('최대 체력을 넘겨 채우지 않는다', () => {
    const world = new World();
    offerMend(world, world.player.maxHp - 3);
    world.chooseUpgrade('mend');
    expect(world.player.hp).toBe(world.player.maxHp);
  });

  it('능력치는 하나도 건드리지 않는다 (되돌리는 것은 몸뿐이다)', () => {
    const stats = baseStats();
    expect(applyUpgrade(stats, mend!)).toEqual(stats);
  });

  it('체력이 가득 차 있으면 후보에서 빠진다 (골라도 아무 일이 없는 카드다)', () => {
    const random = makeRandom(7);
    for (let i = 0; i < 200; i += 1) {
      const choices = rollUpgradeChoices(UPGRADE_CARDS, {}, UPGRADE.choices, random, false);
      expect(choices.map((c) => c.card.id)).not.toContain('mend');
      // 빠져도 3중 1택은 그대로다 — 남은 종류가 넉넉해야 한다.
      expect(choices).toHaveLength(UPGRADE.choices);
    }
  });

  it('다치면 다시 후보에 든다', () => {
    const random = makeRandom(7);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i += 1) {
      seen = rollUpgradeChoices(UPGRADE_CARDS, {}, UPGRADE.choices, random, true).some(
        (c) => c.card.id === 'mend',
      );
    }
    expect(seen).toBe(true);
  });

  it('가득 찬 채로 레벨업하면 World도 회복 카드를 띄우지 않는다', () => {
    const world = new World();
    for (let i = 0; i < 12; i += 1) {
      world.player.hp = world.player.maxHp;
      feedXp(world, xpForLevel(world.progress.level, LEVEL));
      expect(world.offer?.choices.map((c) => c.card.id)).not.toContain('mend');
      pickFirst(world);
    }
  });

  it('쓰러진 몸은 일으키지 못한다 (그 자리는 부활의 몫이다)', () => {
    const world = new World();
    world.player.hp = 0;
    expect(healPlayer(world.player, healAmount)).toBe(0);
    expect(world.player.hp).toBe(0);
  });
});

describe('World — 3중 1택', () => {
  it('레벨이 오르면 카드 3장이 뜬다', () => {
    const world = new World();
    expect(world.offer).toBeNull();
    feedXp(world, xpForLevel(1, LEVEL));
    expect(world.progress.level).toBe(2);
    expect(world.offer?.choices).toHaveLength(UPGRADE.choices);
    expect(world.offer?.level).toBe(2);
    expect(world.isPaused).toBe(true);
  });

  it('카드가 떠 있는 동안 게임이 멈춘다', () => {
    const world = new World();
    feedXp(world, xpForLevel(1, LEVEL));
    const elapsed = world.elapsed;
    const pos = { ...world.player.pos };
    const arrows = world.arrows.map((a) => ({ ...a.pos }));

    for (let i = 0; i < 60; i += 1) world.step({ move: { x: 1, y: 0 }, aim: null }, DT);

    expect(world.elapsed).toBe(elapsed);
    expect(world.player.pos).toEqual(pos);
    expect(world.arrows.map((a) => ({ ...a.pos }))).toEqual(arrows);
  });

  it('고르면 카드가 사라지고 게임이 다시 흐른다', () => {
    const world = new World();
    feedXp(world, xpForLevel(1, LEVEL));
    const id = pickFirst(world);

    expect(world.offer).toBeNull();
    expect(world.isPaused).toBe(false);
    expect(world.upgradeStacks[id]).toBe(1);
    expect(world.takenUpgrades).toEqual([id]);

    const elapsed = world.elapsed;
    world.step(IDLE, DT);
    expect(world.elapsed).toBeGreaterThan(elapsed);
  });

  it('고른 카드가 실제로 게임을 바꾼다 — 연사를 고르면 화살이 더 나간다', () => {
    const fire = (world: World): number => {
      let fired = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 300; i += 1) {
        world.step(IDLE, DT);
        for (const arrow of world.arrows) {
          if (!seen.has(arrow.id)) {
            seen.add(arrow.id);
            fired += 1;
          }
        }
      }
      return fired;
    };

    const plain = new World();
    const base = fire(plain);

    const fast = new World();
    // 카드를 거치지 않고 직접 능력치를 바꾼다 — 여기서 보는 것은 "능력치가 게임에 닿는가"다.
    // 카드를 통해 닿는지는 위의 '고르면' 테스트가 본다.
    const rapid = UPGRADE_CARDS.find((c) => c.id === 'rapid');
    if (!rapid) throw new Error('연사 카드가 없다');
    for (let i = 0; i < 4; i += 1) fast.stats = applyUpgrade(fast.stats, rapid);
    expect(fire(fast)).toBeGreaterThan(base);
  });

  it('한 번에 여러 레벨이 올라도 카드를 그만큼 준다 (레벨업을 놓치지 않는다)', () => {
    const world = new World();
    const need = xpForLevel(1, LEVEL) + xpForLevel(2, LEVEL) + xpForLevel(3, LEVEL);
    feedXp(world, need);
    expect(world.progress.level).toBe(4);

    expect(world.offer?.remaining).toBe(3);
    pickFirst(world);
    expect(world.offer?.remaining).toBe(2);
    pickFirst(world);
    expect(world.offer?.remaining).toBe(1);
    pickFirst(world);

    expect(world.offer).toBeNull();
    expect(world.pendingUpgrades).toBe(0);
    expect(world.takenUpgrades).toHaveLength(3);
  });

  it('없는 카드를 고르면 아무 일도 없다 (멈춘 채로 남지 않는다)', () => {
    const world = new World();
    feedXp(world, xpForLevel(1, LEVEL));
    expect(world.chooseUpgrade('없는-카드')).toBe(false);
    expect(world.isPaused).toBe(true);
    expect(world.takenUpgrades).toHaveLength(0);
    expect(pickFirst(world)).toBeTruthy();
  });

  /**
   * **카드가 열 장이 되면서(세션 57 · `backstep`) 이 장면이 실제 판에서는 사라졌다.**
   * 겹칠 수 있는 총량이 42장(회복을 뺀 40장)인데 한 판의 레벨업은 많아야 39회다
   * (`LEVEL.max` 40). 즉 **끝까지 올려도 고를 카드가 남는다** — 그편이 옳다.
   * 마지막 레벨업에 "고를 것이 없다"가 뜨는 것보다 낫고, 카드를 늘리는 바퀴가
   * 매번 이 수를 맞추려 `maxStacks`를 깎을 이유도 없다.
   *
   * 그래도 **`World.openOffer`의 "고를 것이 없으면 멈추지 않는다"는 규칙은 살아 있어야
   * 한다** — 카드 목록이나 레벨 상한이 바뀌면 다시 닿는 자리이고, 여기가 무너지면
   * 아무도 내릴 수 없는 화면이 된다. 그래서 두 검사로 갈랐다:
   * ① 판 안에서는 다 떨어지지 않는다(아래 첫 검사 · 카드가 줄면 여기가 운다) ·
   * ② 그래도 다 떨어진 자리에서는 멈추지 않는다(둘째 검사 · 미리 채워 두고 그 자리로 간다).
   */
  /** 회복을 뺀, 체력이 가득 찬 사람이 고를 수 있는 카드의 총량. */
  const reachable = UPGRADE_CARDS.filter((c) => c.heal === undefined).reduce(
    (sum, c) => sum + c.maxStacks,
    0,
  );

  it('한 판을 끝까지 올려도 고를 카드가 남는다', () => {
    // **다치지 않은 사람으로 잰다.** 회복 카드는 다친 사람에게만 나오므로
    // (`rollUpgradeChoices`), 체력이 가득 차 있으면 그 두 장이 후보에서 통째로 빠진다.
    // 그 가장 적은 쪽으로도 레벨업 수보다 많다는 것이 여기서 재는 것이다.
    const levelUps = LEVEL.max - 1;
    expect(reachable, '카드가 줄어 판 안에서 다 떨어진다').toBeGreaterThan(levelUps);

    const world = new World();
    feedXp(world, 1e9);
    let picks = 0;
    while (world.offer && picks < reachable + 5) {
      pickFirst(world);
      picks += 1;
    }
    // 레벨업 수만큼만 골랐고, 그것은 카드가 동나서가 아니라 오를 레벨이 없어서다.
    expect(picks).toBe(levelUps);
    expect(world.pendingUpgrades).toBe(0);
    expect(world.isPaused).toBe(false);
  });

  it('고를 카드가 다 떨어지면 카드를 띄우지 않고 그냥 흐른다', () => {
    const world = new World();

    // 서로 다른 두 장만 한 칸씩 남기고 미리 채운다. **World가 보는 그 칸을 그대로 채운다** —
    // 카드를 고르는 길(`chooseUpgrade` → `openOffer`)은 손대지 않으므로, 남은 두 장은
    // 실제 판과 똑같이 뽑히고 골라진다. 한 장에 두 칸을 남기지 않는 이유는, 그러면
    // 마지막 두 번이 같은 카드 하나짜리 선택이 되어 뽑기를 지나지 않기 때문이다.
    let left = 2;
    for (const c of UPGRADE_CARDS) {
      const keep = c.heal === undefined ? Math.min(left, 1) : 0;
      left -= keep;
      world.upgradeStacks[c.id] = c.maxStacks - keep;
    }
    expect(left, '남길 카드를 다 배치하지 못했다').toBe(0);

    // 한 덩이로 최대 레벨까지 올린다. 남은 두 장을 고르고 나면 고를 것이 없다.
    feedXp(world, 1e9);
    let picks = 0;
    while (world.offer && picks < 8) {
      pickFirst(world);
      picks += 1;
    }

    expect(picks).toBe(2);
    expect(world.isPaused).toBe(false);
    expect(world.pendingUpgrades).toBe(0);
    // 멈춘 채로 남지 않는다.
    const elapsed = world.elapsed;
    world.step(IDLE, DT);
    expect(world.elapsed).toBeGreaterThan(elapsed);
  });
});

/**
 * DESIGN 8번 첫 카드 — 다중 발사.
 *
 * 여기서 지키는 것은 두 가지다: 실제로 여러 발이 나가는가, 그리고 **부채꼴이 벌어지는가**.
 * 퍼지는 폭(`ARROW.spread`)이 이 카드의 성격 전부다 — 0에 가까우면 그냥 공격력 3배가 되고,
 * 너무 벌리면 붙어도 한 발밖에 안 맞아 카드가 없는 것과 같아진다.
 */
describe('다중 발사', () => {
  const multishot = UPGRADE_CARDS.find((c) => c.id === 'multishot');
  if (!multishot) throw new Error('다중 발사 카드가 없다');

  /** 카드를 stacks장 고른 채로 첫 발사를 한 번만 시킨 뒤, 그때 나간 화살들. */
  function firstVolley(stacks: number, enemies?: { x: number; y: number }[]) {
    const world = new World(enemies ? { enemies } : {});
    for (let i = 0; i < stacks; i += 1) world.stats = applyUpgrade(world.stats, multishot!);
    world.step(IDLE, DT);
    return { world, arrows: world.arrows.filter((a) => a.owner === 'player') };
  }

  it('한 장에 2발씩 는다 (1 → 3 → 5)', () => {
    expect(firstVolley(0).arrows).toHaveLength(1);
    expect(firstVolley(1).arrows).toHaveLength(3);
    expect(firstVolley(2).arrows).toHaveLength(5);
  });

  it('가운데 한 발은 겨눈 방향 그대로 나가고 나머지는 좌우로 고르게 벌어진다', () => {
    const { world, arrows } = firstVolley(2);
    const angles = arrows.map((a) => Math.atan2(a.vel.y, a.vel.x)).sort((a, b) => a - b);
    expect(angles).toHaveLength(5);
    // 겨눈 방향이 한가운데다. 짝수로 늘리면 이 자리가 비어 조준이 어긋나 보인다.
    expect(angles[2]).toBeCloseTo(world.player.facing, 6);
    for (let i = 1; i < angles.length; i += 1) {
      expect((angles[i] ?? 0) - (angles[i - 1] ?? 0)).toBeCloseTo(ARROW.spread, 6);
    }
    // 화살은 저마다 제 방향으로 총구 거리만큼 앞에서 생긴다(한 점에서 뿌리지 않는다).
    // 태어난 그 스텝에 이미 한 번 날았으므로 그만큼(speed*dt) 더 나가 있다.
    const flown = ARROW.muzzleOffset + ARROW.speed * DT;
    for (const arrow of arrows) {
      const ahead = Math.atan2(arrow.vel.y, arrow.vel.x);
      expect(arrow.pos.x).toBeCloseTo(Math.cos(ahead) * flown, 6);
      expect(arrow.pos.y).toBeCloseTo(Math.sin(ahead) * flown, 6);
    }
  });

  /**
   * 한 뭉치가 한 적에게 몇 발이나 꽂히는가. 적을 그 자리에 못 박고 죽지도 않게 둔다 —
   * 여기서 재는 것은 전투 결과가 아니라 부채꼴이 벌어지는 폭뿐이다.
   */
  function volleyHits(distance: number, stacks: number): number {
    const { world } = firstVolley(stacks, [{ x: distance, y: 0 }]);
    const enemy = world.enemies[0];
    if (!enemy) throw new Error('적이 없다');
    // 두 번째 뭉치가 섞이면 무엇을 세는지 알 수 없다. 첫 뭉치만 남긴다.
    world.player.fireCooldown = 999;
    const steps = Math.ceil((distance / ARROW.speed) * 60) + 20;
    for (let i = 0; i < steps; i += 1) {
      enemy.pos = { x: distance, y: 0 };
      enemy.hp = enemy.maxHp;
      world.player.hp = world.player.maxHp;
      world.step(IDLE, DT);
    }
    return world.hits;
  }

  it('붙으면 한 놈에게 다 꽂히고, 멀면 가운데 한 발만 맞는다', () => {
    expect(volleyHits(5, 1)).toBe(3);
    expect(volleyHits(14, 1)).toBe(1);
  });
});

/**
 * DESIGN 8번 두 번째 카드 — 관통.
 *
 * 카드가 실제로 게임에 닿는 자리는 셋이다: 능력치에 더해지는가, 태어나는 화살이 그것을
 * 들고 나가는가(적의 화살은 들지 않는다), 그리고 **다중 발사와 겹쳤을 때 다섯 발이
 * 저마다 뚫는가.** 셋째가 이 카드를 넣으며 가장 조심한 곳이다.
 */
describe('관통', () => {
  const pierceCard = UPGRADE_CARDS.find((c) => c.id === 'pierce');
  const multishotCard = UPGRADE_CARDS.find((c) => c.id === 'multishot');
  if (!pierceCard || !multishotCard) throw new Error('관통·다중 발사 카드가 없다');

  it('한 장에 1명씩 더 뚫는다 (0 → 1 → 2)', () => {
    let stats = baseStats();
    expect(stats.pierce).toBe(0);
    stats = applyUpgrade(stats, pierceCard);
    expect(stats.pierce).toBe(1);
    stats = applyUpgrade(stats, pierceCard);
    expect(stats.pierce).toBe(2);
  });

  it('플레이어의 화살만 관통을 들고 나간다', () => {
    const world = new World({ enemies: [] });
    world.stats = applyUpgrade(world.stats, pierceCard);
    world.addArrow({ x: 0, y: 0 }, { x: 1, y: 0 }, 'player');
    world.addArrow({ x: 0, y: 0 }, { x: 1, y: 0 }, 'enemy');
    expect(world.arrows.find((a) => a.owner === 'player')?.pierce).toBe(1);
    expect(world.arrows.find((a) => a.owner === 'enemy')?.pierce).toBe(0);
  });

  /**
   * 앞뒤로 선 두 놈에게 한 뭉치가 몇 번 꽂히는가. 다중 발사 쪽과 같은 방식으로
   * 적을 그 자리에 못 박고 죽지 않게 둔다 — 재는 것은 전투 결과가 아니라 뚫는 횟수다.
   */
  function volleyHits(stacks: { multishot: number; pierce: number }): number {
    const world = new World({ enemies: [{ x: 4, y: 0 }, { x: 8, y: 0 }] });
    for (let i = 0; i < stacks.multishot; i += 1) {
      world.stats = applyUpgrade(world.stats, multishotCard!);
    }
    for (let i = 0; i < stacks.pierce; i += 1) {
      world.stats = applyUpgrade(world.stats, pierceCard!);
    }
    world.step(IDLE, DT);
    world.player.fireCooldown = 999; // 두 번째 뭉치가 섞이면 무엇을 세는지 알 수 없다.
    const pinned = world.enemies.map((e) => ({ enemy: e, at: { ...e.pos } }));
    for (let i = 0; i < 60; i += 1) {
      for (const { enemy, at } of pinned) {
        enemy.pos = { x: at.x, y: at.y };
        enemy.hp = enemy.maxHp;
      }
      world.player.hp = world.player.maxHp;
      world.step(IDLE, DT);
    }
    return world.hits;
  }

  it('한 발이 앞엣놈을 뚫고 뒤엣놈까지 간다', () => {
    expect(volleyHits({ multishot: 0, pierce: 0 })).toBe(1);
    expect(volleyHits({ multishot: 0, pierce: 1 })).toBe(2);
  });

  it('다중 발사와 겹치면 다섯 발이 저마다 뚫는다', () => {
    // 4m에서는 부채꼴 중 세 발이 앞엣놈에 닿고(다중 발사 검사와 같은 성질),
    // 8m까지 벌어지면 가운데 한 발만 남는다. 3 + 1 = 4.
    expect(volleyHits({ multishot: 2, pierce: 0 })).toBe(3);
    expect(volleyHits({ multishot: 2, pierce: 1 })).toBe(4);
  });
});

/**
 * DESIGN 8번 세 번째 카드 — 튕김.
 *
 * 관통과 같은 세 자리를 본다(능력치에 더해지는가 · 태어나는 화살이 들고 나가는가 ·
 * 실제 판에서 몇 번을 더 맞히는가). 다른 것은 마지막 하나다 — 관통은 **줄 뒤에 선 놈**을
 * 맞히지만, 튕김은 **옆에 선 놈**을 맞힌다. 그래서 재는 장면도 앞뒤가 아니라 좌우로 세운다.
 */
describe('튕김', () => {
  const bounceCard = UPGRADE_CARDS.find((c) => c.id === 'bounce');
  if (!bounceCard) throw new Error('튕김 카드가 없다');

  it('한 장에 1번씩 더 튕긴다 (0 → 1 → 2)', () => {
    let stats = baseStats();
    expect(stats.bounce).toBe(0);
    stats = applyUpgrade(stats, bounceCard);
    expect(stats.bounce).toBe(1);
    stats = applyUpgrade(stats, bounceCard);
    expect(stats.bounce).toBe(2);
  });

  it('플레이어의 화살만 튕김을 들고 나간다', () => {
    // 적의 화살이 노리는 것은 한 사람뿐이라 꺾어 갈 다음 상대가 없다.
    const world = new World({ enemies: [] });
    world.stats = applyUpgrade(world.stats, bounceCard);
    world.addArrow({ x: 0, y: 0 }, { x: 1, y: 0 }, 'player');
    world.addArrow({ x: 0, y: 0 }, { x: 1, y: 0 }, 'enemy');
    expect(world.arrows.find((a) => a.owner === 'player')?.bounce).toBe(1);
    expect(world.arrows.find((a) => a.owner === 'enemy')?.bounce).toBe(0);
  });

  /**
   * 나란히 선 두 놈에게 한 발이 몇 번 꽂히는가. 다중 발사·관통 쪽과 같은 방식으로
   * 적을 그 자리에 못 박고 죽지 않게 둔다 — 재는 것은 전투 결과가 아니라 꺾이는 횟수다.
   */
  function volleyHits(stacks: number): number {
    const world = new World({
      enemies: [
        { x: 6, y: 0 },
        { x: 6, y: 5 },
      ],
    });
    for (let i = 0; i < stacks; i += 1) world.stats = applyUpgrade(world.stats, bounceCard!);
    world.step(IDLE, DT);
    world.player.fireCooldown = 999; // 두 번째 뭉치가 섞이면 무엇을 세는지 알 수 없다.
    const pinned = world.enemies.map((e) => ({ enemy: e, at: { ...e.pos } }));
    for (let i = 0; i < 60; i += 1) {
      for (const { enemy, at } of pinned) {
        enemy.pos = { x: at.x, y: at.y };
        enemy.hp = enemy.maxHp;
      }
      world.player.hp = world.player.maxHp;
      world.step(IDLE, DT);
    }
    return world.hits;
  }

  it('한 발이 옆에 선 놈까지 꺾여 간다 (1 → 2 → 3)', () => {
    expect(volleyHits(0)).toBe(1);
    expect(volleyHits(1)).toBe(2);
    expect(volleyHits(2)).toBe(3);
  });
});

/**
 * DESIGN 8번 아홉째 카드 — 밀어내기.
 *
 * 관통·튕김과 같은 두 자리를 본다(능력치에 더해지는가 · 태어나는 화살이 들고 나가는가).
 * **적의 화살이 0인 까닭만 다르다.** 관통·튕김은 갈 다음 상대가 없어서 0이지만,
 * 밀어내기는 갈 곳이 있는데도 0이다 — 적의 화살이 사람을 밀면 터질 원 밖으로 밀려나는
 * 프레임이 생겨, **맞는 것이 사는 길**이 된다(DESIGN 9번 폭탄병).
 *
 * 누가 밀리고 누가 안 밀리는가는 `tests/systems.test.ts`가 한 프레임으로 본다.
 */
describe('밀어내기', () => {
  const repelCard = UPGRADE_CARDS.find((c) => c.id === 'repel');
  if (!repelCard) throw new Error('밀어내기 카드가 없다');

  it('한 장에 0.45m씩 는다 (0 → 0.45 → 0.9)', () => {
    // 시작값이 0이라 곱셈이 뜻을 잃는다 — 개수 카드들과 같은 이유로 덧셈이다.
    let stats = baseStats();
    expect(stats.knockback).toBe(0);
    stats = applyUpgrade(stats, repelCard);
    expect(stats.knockback).toBeCloseTo(0.45, 6);
    stats = applyUpgrade(stats, repelCard);
    expect(stats.knockback).toBeCloseTo(0.9, 6);
  });

  it('플레이어의 화살만 밀어내기를 들고 나간다', () => {
    const world = new World({ enemies: [] });
    world.stats = applyUpgrade(world.stats, repelCard);
    world.addArrow({ x: 0, y: 0 }, { x: 1, y: 0 }, 'player');
    world.addArrow({ x: 0, y: 0 }, { x: 1, y: 0 }, 'enemy');
    expect(world.arrows.find((a) => a.owner === 'player')?.knockback).toBeCloseTo(0.45, 6);
    expect(world.arrows.find((a) => a.owner === 'enemy')?.knockback).toBe(0);
  });

  it('실제 판에서 맞은 적이 뒤로 물러난다', () => {
    // 한 발을 맞히고 적이 옮겨 간 거리를 잰다. 적이 제 걸음으로 다가오는 몫이 섞이지
    // 않도록 **다가오지 않는 거리**(사거리 안이라 겨누려고 서는 자리)에 세우지 않고,
    // 맞은 프레임의 앞뒤만 견준다.
    const world = new World({ enemies: [{ x: 7, y: 0 }] });
    world.stats = applyUpgrade(world.stats, repelCard);
    const enemy = world.enemies[0]!;
    let pushedBack = 0;
    for (let i = 0; i < 240 && pushedBack === 0; i += 1) {
      const before = { ...enemy.pos };
      const hits = world.hits;
      world.step(IDLE, DT);
      if (world.hits > hits) pushedBack = Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y);
    }
    // 한 프레임에 제 걸음으로 갈 수 있는 거리는 0.1m가 안 된다(속력 3.4m/s · 1/60초).
    expect(pushedBack).toBeGreaterThan(0.3);
  });
});

/**
 * DESIGN 8번 열째 카드 — 뒷걸음.
 *
 * **앞의 아홉과 달리 능력치를 읽는 것만으로는 이 카드가 듣는지 알 수 없다.**
 * 그래서 여기서 보는 것은 값이 더해지는가 하나와, **실제 판에서 걸음이 달라지는가**다.
 * 한 프레임의 규칙(무엇이 기준이고 어떻게 차오르는가)은 `tests/systems.test.ts`가 본다.
 */
describe('뒷걸음', () => {
  const backstepCard = UPGRADE_CARDS.find((c) => c.id === 'backstep');
  if (!backstepCard) throw new Error('뒷걸음 카드가 없다');

  it('겹칠 때마다 더해진다 (0 → 0.25 → 0.5)', () => {
    let stats = baseStats();
    expect(stats.backstep).toBe(0);
    stats = applyUpgrade(stats, backstepCard);
    expect(stats.backstep).toBeCloseTo(0.25, 6);
    stats = applyUpgrade(stats, backstepCard);
    expect(stats.backstep).toBeCloseTo(0.5, 6);
  });

  it('이동 속도 자체는 건드리지 않는다 — 파고들 때는 그대로다', () => {
    const stats = baseStats();
    expect(applyUpgrade(stats, backstepCard).moveSpeed).toBe(stats.moveSpeed);
  });

  /** 적 하나를 세워 두고 한 방향으로 1초를 걷는다. 걸은 거리를 돌려준다. */
  function walked(stacks: number, move: { x: number; y: number }): number {
    // 적을 +x 쪽에 세우면 자동 조준이 그쪽을 본다 — 화면에서 몸이 보는 쪽이다.
    const world = new World({ enemies: [{ x: 12, y: 0 }] });
    for (let i = 0; i < stacks; i += 1) world.stats = applyUpgrade(world.stats, backstepCard!);
    // 몸이 다 돌아선 뒤부터 잰다(`PLAYER.turnRate`). 도는 동안은 겨눈 쪽이 움직인다.
    for (let i = 0; i < 30; i += 1) world.step(IDLE, DT);
    const from = { ...world.player.pos };
    for (let i = 0; i < 60; i += 1) world.step({ move, aim: null }, DT);
    return Math.hypot(world.player.pos.x - from.x, world.player.pos.y - from.y);
  }

  it('실제 판에서 물러나는 걸음만 빨라진다', () => {
    const back = { x: -1, y: 0 };
    const forward = { x: 1, y: 0 };
    // 물러나는 쪽은 한 장에 1.25배, 두 장에 1.5배.
    expect(walked(1, back) / walked(0, back)).toBeCloseTo(1.25, 2);
    expect(walked(2, back) / walked(0, back)).toBeCloseTo(1.5, 2);
    // 파고드는 쪽은 한 걸음도 달라지지 않는다.
    expect(walked(2, forward)).toBeCloseTo(walked(0, forward), 6);
  });

  it('등을 보이고 달아나면 아무것도 해 주지 않는다', () => {
    // 오른쪽 스틱으로 반대쪽을 겨눈 채 그 반대로 달아나는 사람.
    // 겨눈 쪽에서 물러나는 것이 아니므로 걸음이 그대로다.
    const away = (stacks: number): number => {
      const world = new World({ enemies: [{ x: 12, y: 0 }] });
      for (let i = 0; i < stacks; i += 1) world.stats = applyUpgrade(world.stats, backstepCard!);
      const input: FrameInput = { move: { x: -1, y: 0 }, aim: { x: -1, y: 0 } };
      for (let i = 0; i < 30; i += 1) world.step(input, DT);
      const from = { ...world.player.pos };
      for (let i = 0; i < 60; i += 1) world.step(input, DT);
      return Math.hypot(world.player.pos.x - from.x, world.player.pos.y - from.y);
    };
    expect(away(2)).toBeCloseTo(away(0), 6);
  });
});

/**
 * 카드 색은 화면에서 서로 구별돼야 한다 — 세 장이 나란히 뜨므로, 두 장이 비슷한 색이면
 * "무엇을 골랐는지"가 기억에 남지 않는다. 카드를 넣을 때마다 눈으로 보고 판단해 왔는데
 * (세션 10·11·12) 같은 판단이 세 번 반복됐으므로 기계가 재게 한다.
 */
describe('카드 색', () => {
  const rgb = (hex: string): [number, number, number] => {
    const v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };

  it('어느 두 장도 비슷한 색이 아니다', () => {
    // 지금 가장 가까운 짝은 연사(노랑)와 다중 발사(주황)로 54쯤이다.
    // 새 카드가 이보다 가까워지면 화면에서 두 장이 한 색으로 읽힌다.
    const limit = 50;
    const tooClose: string[] = [];
    for (let i = 0; i < UPGRADE_CARDS.length; i += 1) {
      for (let j = i + 1; j < UPGRADE_CARDS.length; j += 1) {
        const a = UPGRADE_CARDS[i]!;
        const b = UPGRADE_CARDS[j]!;
        const [ar, ag, ab] = rgb(a.accent);
        const [br, bg, bb] = rgb(b.accent);
        const distance = Math.hypot(ar - br, ag - bg, ab - bb);
        // 어긋난 짝을 이름으로 모아 둔다 — 실패했을 때 어느 두 장인지 바로 보여야 한다.
        if (distance < limit) tooClose.push(`${a.id}↔${b.id}(${distance.toFixed(0)})`);
      }
    }
    expect(tooClose).toEqual([]);
  });
});

/**
 * **카드 한 장을 눈으로 볼 수 있는가** (`tools/card-shot.mjs`).
 *
 * 지시서 ⑥("화면이 있는 것을 만들면 실행해서 스크린샷을 찍고 그 이미지를 직접 읽어라")은
 * **찍을 수 있을 때만** 지킬 수 있는 규칙이다. 카드 화면에 어느 셋이 뜨는지는 판이 정하므로
 * (`rollUpgradeChoices`), 방금 만든 카드가 그 셋에 드는지는 운이다 —
 * `npm run qa`로는 새 카드를 볼 방법이 없어 세션 53은 임시 하네스를 짰다가 버렸다.
 *
 * 그래서 그 도구는 **뜬 셋을 내려놓고 다시 뽑는다**(고르지 않는다). 아래 둘이 그 규칙이다.
 * 하나라도 깨지면 도구는 조용히 30초를 기다리다 아무것도 못 찍는다 —
 * 도구는 타입 검사가 닿지 않는 `.mjs`라 아무도 말해 주지 않는다(`tests/enemyShot.test.mjs`와 같은 자리).
 */
describe('카드를 찍는 도구가 기대는 규칙', () => {
  /** 다친 채로 레벨을 올려 카드를 띄운다. 도구가 하는 것과 같다(`cardProbe`). */
  function offerAtLevelUp(world: World): void {
    world.player.hp = world.player.maxHp * 0.55;
    feedXp(world, xpForLevel(world.progress.level, LEVEL));
  }

  /**
   * 뜬 셋을 내려놓고 한 스텝 돌린다 — 도구가 되뽑는 방법 그대로다.
   * **다친 채로 둔다**: 체력이 가득 차면 회복 카드가 후보에서 빠진다(`World.openOffer`).
   */
  function reroll(world: World): void {
    world.offer = null;
    world.player.hp = world.player.maxHp * 0.55;
    world.step(IDLE, DT);
  }

  it('카드를 내려놓고 한 스텝 돌리면 같은 레벨에서 다시 뽑힌다', () => {
    const world = new World();
    offerAtLevelUp(world);
    const before = world.offer;
    expect(before).not.toBeNull();

    reroll(world);

    // 다시 떴다 — 레벨도 남은 선택 횟수도 그대로다. 한 장도 고르지 않았으므로
    // 능력치와 눈금(`up-card__pips`)도 처음 보는 카드 그대로다.
    expect(world.offer).not.toBeNull();
    expect(world.offer?.level).toBe(before!.level);
    expect(world.pendingUpgrades).toBe(1);
    expect(world.takenUpgrades).toEqual([]);
  });

  it('되뽑으면 어느 카드든 예순 번 안에 뜬다', () => {
    // 도구의 상한(`REROLLS`)과 같은 수다. 여기서 넘치면 그 카드는 도구로 못 찍는다 —
    // 이를테면 후보에서 영영 빠지는 조건이 붙은 카드가 새로 들어온 경우다.
    const limit = 60;
    const worst: string[] = [];
    for (const target of UPGRADE_CARDS) {
      const world = new World();
      offerAtLevelUp(world);
      let tries = 0;
      while (tries < limit && !world.offer?.choices.some((c) => c.card.id === target.id)) {
        reroll(world);
        tries += 1;
      }
      if (tries >= limit) worst.push(target.id);
    }
    expect(worst).toEqual([]);
  });
});
