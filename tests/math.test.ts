import { describe, expect, it } from 'vitest';
import { applyDeadzone, length, normalize, rotateToward, wrapAngle } from '../src/core/math';

describe('applyDeadzone', () => {
  it('데드존 안쪽 입력은 0으로 죽인다', () => {
    expect(applyDeadzone({ x: 0.1, y: 0 }, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('데드존 경계 바로 바깥에서 값이 튀지 않고 0에서 시작한다', () => {
    const value = applyDeadzone({ x: 0.21, y: 0 }, 0.2);
    expect(value.x).toBeGreaterThan(0);
    expect(value.x).toBeLessThan(0.05);
  });

  it('대각선 입력이 직선 입력보다 빠르지 않다', () => {
    const diagonal = applyDeadzone({ x: 1, y: 1 }, 0.2);
    expect(length(diagonal)).toBeCloseTo(1, 5);
  });
});

describe('normalize', () => {
  it('길이 0 벡터는 0을 돌려준다 (NaN이 게임 전체로 번지지 않게)', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('rotateToward', () => {
  it('한 번에 maxStep 이상 돌지 않는다', () => {
    expect(rotateToward(0, 1.2, 0.1)).toBeCloseTo(0.1, 6);
    // 정확히 180도 반대편은 어느 쪽으로 돌아도 같다. 방향은 묻지 않고 보폭만 본다.
    expect(Math.abs(rotateToward(0, Math.PI, 0.1))).toBeCloseTo(0.1, 6);
  });

  it('목표에 도달하면 넘어가지 않고 멈춘다', () => {
    expect(rotateToward(0, 0.05, 0.1)).toBeCloseTo(0.05, 6);
  });

  it('-PI/PI 경계를 가로질러 짧은 쪽으로 돈다', () => {
    const next = rotateToward(Math.PI - 0.05, -Math.PI + 0.05, 0.2);
    expect(wrapAngle(next - (-Math.PI + 0.05))).toBeCloseTo(0, 6);
  });
});
