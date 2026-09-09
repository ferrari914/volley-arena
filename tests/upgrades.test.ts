import { describe, expect, it } from 'vitest';
import { World, type FrameInput } from '../src/core/World';
import { ARROW, LEVEL, UPGRADE } from '../src/data/config';
import { UPGRADE_CARDS } from '../src/data/upgrades';
import { createXpCore, type UpgradeCard } from '../src/entities/types';
import { applyUpgrade, rollUpgradeChoices } from '../src/systems/upgrades';
import { xpForLevel } from '../src/systems/experience';

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

const card = (id: string, maxStacks = 3): UpgradeCard => ({
  id,
  title: id,
  detail: '',
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

describe('업그레이드 적용', () => {
  it('적힌 값에만 곱하고 원래 값은 건드리지 않는다', () => {
    const stats = { fireCooldown: 0.4, moveSpeed: 7, magnetRadius: 4, xpMultiplier: 1, arrowCount: 1 };
    const next = applyUpgrade(stats, card('swift'));
    expect(next.moveSpeed).toBeCloseTo(7.7, 6);
    expect(next.fireCooldown).toBe(0.4);
    expect(stats.moveSpeed).toBe(7);
  });

  it('개수 카드는 곱하지 않고 더한다 (화살 1.5발은 없다)', () => {
    const stats = { fireCooldown: 0.4, moveSpeed: 7, magnetRadius: 4, xpMultiplier: 1, arrowCount: 1 };
    const plus: UpgradeCard = {
      id: 'volley',
      title: 'volley',
      detail: '',
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
    let stats = { fireCooldown: 0.4, moveSpeed: 7, magnetRadius: 4, xpMultiplier: 1, arrowCount: 1 };
    stats = applyUpgrade(stats, card('swift'));
    stats = applyUpgrade(stats, card('swift'));
    expect(stats.moveSpeed).toBeCloseTo(7 * 1.1 * 1.1, 6);
  });

  it('목록의 카드는 전부 무언가를 바꾼다', () => {
    for (const c of UPGRADE_CARDS) {
      const changes = Object.keys(c.multiply ?? {}).length + Object.keys(c.add ?? {}).length;
      expect(changes).toBeGreaterThan(0);
      expect(c.maxStacks).toBeGreaterThan(0);
      expect(c.detail.length).toBeGreaterThan(0);
    }
    // id가 겹치면 고른 횟수가 뒤섞인다.
    expect(new Set(UPGRADE_CARDS.map((c) => c.id)).size).toBe(UPGRADE_CARDS.length);
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

  it('고를 카드가 다 떨어지면 카드를 띄우지 않고 그냥 흐른다', () => {
    const world = new World();
    const total = UPGRADE_CARDS.reduce((sum, c) => sum + c.maxStacks, 0);

    // 한 덩이로 최대 레벨까지 올린다. 레벨업 수(39)가 카드 총량(30)보다 많아
    // 마지막에는 고를 것이 없는 상태가 된다.
    feedXp(world, 1e9);
    let picks = 0;
    while (world.offer && picks < total + 5) {
      pickFirst(world);
      picks += 1;
    }

    expect(picks).toBe(total);
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
