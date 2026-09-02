import { describe, expect, it } from 'vitest';
import { movePlayer } from '../src/systems/movement';
import { findNearestTarget } from '../src/systems/autoAim';
import { segmentPointDistanceSq, stepArrows, stepTargets } from '../src/systems/combat';
import { createTarget, type Arrow } from '../src/entities/types';

const arrow = (x: number, y: number, vx: number, vy: number): Arrow => ({
  id: 1,
  pos: { x, y },
  vel: { x: vx, y: vy },
  age: 0,
  alive: true,
});

const options = {
  dt: 1 / 60,
  arenaRadius: 26,
  arrowRadius: 0.16,
  targetRadius: 0.7,
  lifetime: 1.6,
  respawnDelay: 1.4,
};

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

describe('findNearestTarget', () => {
  it('사거리 안에서 가장 가까운 것을 고른다', () => {
    const near = createTarget(3, 0);
    const far = createTarget(10, 0);
    expect(findNearestTarget({ x: 0, y: 0 }, [far, near], 22)).toBe(near);
  });

  it('쓰러진 대상은 고르지 않는다', () => {
    const near = createTarget(3, 0);
    near.alive = false;
    const far = createTarget(10, 0);
    expect(findNearestTarget({ x: 0, y: 0 }, [near, far], 22)).toBe(far);
  });

  it('사거리 밖이면 null', () => {
    expect(findNearestTarget({ x: 0, y: 0 }, [createTarget(30, 0)], 22)).toBeNull();
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
  it('한 스텝에 대상을 지나쳐 버려도 명중으로 잡는다 (터널링 방지)', () => {
    const target = createTarget(0.4, 0);
    // 한 프레임 이동 거리(2)가 대상 지름보다 크다. 위치만 비교하면 놓친다.
    const result = stepArrows([arrow(-1, 0, 120, 0)], [target], options);
    expect(result.hits).toBe(1);
    expect(target.alive).toBe(false);
  });

  it('맞은 화살은 사라지고 대상은 잠시 뒤 다시 선다', () => {
    const target = createTarget(0.4, 0);
    const flying = arrow(-1, 0, 120, 0);
    stepArrows([flying], [target], options);
    expect(flying.alive).toBe(false);

    for (let i = 0; i < 120; i += 1) stepTargets([target], options.dt);
    expect(target.alive).toBe(true);
    expect(target.pos).toEqual(target.home);
  });

  it('아레나 밖으로 나가면 사라진다', () => {
    const flying = arrow(25.9, 0, 120, 0);
    stepArrows([flying], [], options);
    expect(flying.alive).toBe(false);
  });

  it('수명이 다하면 사라진다', () => {
    const flying = arrow(0, 0, 0, 0);
    for (let i = 0; i < 200 && flying.alive; i += 1) stepArrows([flying], [], options);
    expect(flying.alive).toBe(false);
    expect(flying.age).toBeGreaterThanOrEqual(options.lifetime);
  });
});
