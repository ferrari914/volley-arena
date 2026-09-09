import { describe, expect, it } from 'vitest';
import { movePlayer } from '../src/systems/movement';
import { findNearestEnemy } from '../src/systems/autoAim';
import { segmentPointDistanceSq, stepArrows } from '../src/systems/combat';
import { createEnemy, createPlayer, type Arrow, type ArrowOwner } from '../src/entities/types';
import { ENEMY, PLAYER } from '../src/data/config';

let nextId = 1;
const enemyAt = (x: number, y: number): ReturnType<typeof createEnemy> =>
  createEnemy(nextId++, x, y, ENEMY.maxHp);

const arrow = (
  x: number,
  y: number,
  vx: number,
  vy: number,
  owner: ArrowOwner = 'player',
  damage = 1,
  pierce = 0,
): Arrow => ({
  id: 1,
  owner,
  pos: { x, y },
  vel: { x: vx, y: vy },
  damage,
  age: 0,
  lifetime: 1.6,
  pierce,
  alive: true,
});

/** 화살만 따로 보고 싶을 때의 기본 판. 플레이어와 적은 부르는 쪽이 채운다. */
function options(overrides: Partial<Parameters<typeof stepArrows>[1]> = {}) {
  return {
    dt: 1 / 60,
    arenaRadius: 26,
    arrowRadius: 0.16,
    enemyRadius: ENEMY.radius,
    playerRadius: PLAYER.radius,
    invulnerable: PLAYER.invulnerable,
    respawnDelay: ENEMY.respawnDelay,
    player: createPlayer(PLAYER.maxHp),
    enemies: [],
    ...overrides,
  };
}

describe('movePlayer', () => {
  it('아레나 밖으로 나가지 못한다', () => {
    const next = movePlayer({ x: 25.8, y: 0 }, { x: 1, y: 0 }, 1, 20, 26, 0.55);
    expect(Math.hypot(next.x, next.y)).toBeLessThanOrEqual(26 - 0.55 + 1e-6);
  });

  it('벽에 붙어 옆으로 밀면 미끄러지며 계속 움직인다', () => {
    const start = { x: 25.4, y: 0 };
    const next = movePlayer(start, { x: 1, y: 1 }, 1 / 60, 7.2, 26, 0.55);
    expect(next.y).toBeGreaterThan(start.y);
  });
});

describe('findNearestEnemy', () => {
  it('사거리 안에서 가장 가까운 것을 고른다', () => {
    const near = enemyAt(3, 0);
    const far = enemyAt(10, 0);
    expect(findNearestEnemy({ x: 0, y: 0 }, [far, near], 22)).toBe(near);
  });

  it('쓰러진 적은 고르지 않는다', () => {
    const near = enemyAt(3, 0);
    near.alive = false;
    const far = enemyAt(10, 0);
    expect(findNearestEnemy({ x: 0, y: 0 }, [near, far], 22)).toBe(far);
  });

  it('사거리 밖이면 null', () => {
    expect(findNearestEnemy({ x: 0, y: 0 }, [enemyAt(30, 0)], 22)).toBeNull();
  });
});

describe('segmentPointDistanceSq', () => {
  it('선분 위를 지나가면 거리 0', () => {
    expect(segmentPointDistanceSq({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0);
  });

  it('선분 끝을 넘어선 점은 끝점까지의 거리로 잰다', () => {
    expect(segmentPointDistanceSq({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBeCloseTo(4);
  });
});

describe('stepArrows', () => {
  it('한 스텝에 적을 지나쳐 버려도 명중으로 잡는다 (터널링 방지)', () => {
    const enemy = enemyAt(0.4, 0);
    // 한 프레임 이동 거리(2)가 적의 지름보다 크다. 위치만 비교하면 놓친다.
    const result = stepArrows([arrow(-1, 0, 120, 0)], options({ enemies: [enemy] }));
    expect(result.hits).toBe(1);
    expect(enemy.hp).toBe(ENEMY.maxHp - 1);
  });

  it('체력을 다 깎아야 쓰러지고, 그때만 코어 자리를 돌려준다', () => {
    const enemy = enemyAt(0.4, 0);
    let result = stepArrows([arrow(-1, 0, 120, 0)], options({ enemies: [enemy] }));
    expect(result.kills).toBe(0);
    expect(result.killPoints).toHaveLength(0);
    expect(enemy.alive).toBe(true);

    for (let i = 1; i < ENEMY.maxHp; i += 1) {
      result = stepArrows([arrow(-1, 0, 120, 0)], options({ enemies: [enemy] }));
    }
    expect(enemy.alive).toBe(false);
    expect(result.kills).toBe(1);
    expect(result.killPoints).toHaveLength(1);
    expect(enemy.respawnTimer).toBe(ENEMY.respawnDelay);
  });

  it('플레이어의 화살은 플레이어를 맞히지 않는다', () => {
    const player = createPlayer(PLAYER.maxHp);
    const result = stepArrows([arrow(-1, 0, 120, 0)], options({ player }));
    expect(result.damageTaken).toBe(0);
    expect(player.hp).toBe(PLAYER.maxHp);
  });

  it('적의 화살은 적을 맞히지 않고 플레이어만 깎는다', () => {
    const player = createPlayer(PLAYER.maxHp);
    const enemy = enemyAt(0.4, 0);
    const result = stepArrows(
      [arrow(-1, 0, 120, 0, 'enemy', 7)],
      options({ player, enemies: [enemy] }),
    );
    expect(enemy.hp).toBe(ENEMY.maxHp);
    expect(result.damageTaken).toBe(7);
    expect(player.hp).toBe(PLAYER.maxHp - 7);
  });

  it('무적인 동안에는 적의 화살이 그냥 지나간다', () => {
    const player = createPlayer(PLAYER.maxHp);
    stepArrows([arrow(-1, 0, 120, 0, 'enemy', 7)], options({ player }));
    expect(player.invulnerable).toBe(PLAYER.invulnerable);

    // 같은 순간에 두 번째 화살이 꽂혀도 체력은 한 번만 깎인다.
    const second = arrow(-1, 0, 120, 0, 'enemy', 7);
    const result = stepArrows([second], options({ player }));
    expect(result.damageTaken).toBe(0);
    expect(player.hp).toBe(PLAYER.maxHp - 7);
    expect(second.alive).toBe(true);
  });

  it('아레나 밖으로 나가면 사라진다', () => {
    const flying = arrow(25.9, 0, 120, 0);
    stepArrows([flying], options());
    expect(flying.alive).toBe(false);
  });

  it('수명이 다하면 사라진다', () => {
    const flying = arrow(0, 0, 0, 0);
    for (let i = 0; i < 200 && flying.alive; i += 1) stepArrows([flying], options());
    expect(flying.alive).toBe(false);
    expect(flying.age).toBeGreaterThanOrEqual(flying.lifetime);
  });
});

/**
 * DESIGN 8번 두 번째 카드 — 관통.
 *
 * 여기서 지키는 것은 둘이다: 뒤에 선 놈까지 뚫고 가는가, 그리고 **한 놈을 한 번만
 * 맞히는가.** 두 번째가 진짜 함정이다 — 한 프레임에 나아가는 거리(34m/s × 1/60 ≈ 0.57m)가
 * 적 판정 지름(1.72m)보다 짧아서, 맞힌 적을 기억하지 않으면 몸을 빠져나가는 서너 프레임 동안
 * 계속 꽂힌다. 그러면 관통이 아니라 "가까이 붙으면 피해 3배"가 된다.
 */
describe('stepArrows — 관통', () => {
  /** 화살 하나를 여러 스텝 날리고 그동안의 명중을 합친다. */
  function fly(flying: Arrow, enemies: ReturnType<typeof enemyAt>[], steps: number): number {
    let hits = 0;
    for (let i = 0; i < steps; i += 1) hits += stepArrows([flying], options({ enemies })).hits;
    return hits;
  }

  it('관통이 없으면 처음 맞힌 자리에서 멈춘다', () => {
    const line = [enemyAt(2, 0), enemyAt(5, 0)];
    const flying = arrow(0, 0, 34, 0);
    expect(fly(flying, line, 30)).toBe(1);
    expect(flying.alive).toBe(false);
    expect(line[1]?.hp).toBe(ENEMY.maxHp);
  });

  it('관통이 남은 만큼 뒤엣놈을 뚫고 가다가, 다 쓰면 거기서 멈춘다', () => {
    const line = [enemyAt(2, 0), enemyAt(5, 0), enemyAt(8, 0)];
    const flying = arrow(0, 0, 34, 0, 'player', 1, 1);
    expect(fly(flying, line, 30)).toBe(2);
    expect(flying.alive).toBe(false);
    expect(line[0]?.hp).toBe(ENEMY.maxHp - 1);
    expect(line[1]?.hp).toBe(ENEMY.maxHp - 1);
    // 관통을 다 쓴 뒤에 만난 셋째는 멀쩡하다.
    expect(line[2]?.hp).toBe(ENEMY.maxHp);
  });

  it('한 놈을 여러 프레임에 걸쳐 다시 맞히지 않는다', () => {
    // 느린 화살이라 적의 몸 안에 열 프레임 넘게 머문다. 기억하지 않으면 그만큼 꽂힌다.
    const slow = arrow(0, 0, 6, 0, 'player', 1, 2);
    const single = [enemyAt(1, 0)];
    expect(fly(slow, single, 40)).toBe(1);
    // 관통을 한 번만 쓰고 계속 날아간다.
    expect(slow.pierce).toBe(1);
    expect(slow.alive).toBe(true);
  });

  it('쓰러뜨린 뒤에도 남은 관통으로 다음 놈을 맞힌다', () => {
    const front = enemyAt(2, 0);
    front.hp = 1;
    const line = [front, enemyAt(5, 0)];
    const flying = arrow(0, 0, 34, 0, 'player', 1, 1);
    expect(fly(flying, line, 30)).toBe(2);
    expect(front.alive).toBe(false);
    expect(line[1]?.hp).toBe(ENEMY.maxHp - 1);
  });
});
