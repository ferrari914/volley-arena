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
): Arrow => ({
  id: 1,
  owner,
  pos: { x, y },
  vel: { x: vx, y: vy },
  damage,
  age: 0,
  lifetime: 1.6,
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
