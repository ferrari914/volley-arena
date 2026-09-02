/** 수평면(XZ) 위의 2D 벡터. y가 월드의 Z축이다. */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len > 1e-6 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 두 점 사이 거리의 제곱. 비교만 할 때는 제곱근을 뽑지 않는다. */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * 스틱 입력을 게임이 쓸 방향 벡터로 다듬는다.
 * - deadzone 안쪽은 0으로 죽인다 (손가락이 가만히 있어도 미세하게 떨린다)
 * - deadzone 바깥은 0~1로 다시 폈다. 경계에서 속도가 튀지 않게 한다
 * - 길이는 1을 넘지 않는다 (대각선이 더 빠른 고전적인 버그 방지)
 */
export function applyDeadzone(raw: Vec2, deadzone: number): Vec2 {
  const len = length(raw);
  if (len <= deadzone) return { x: 0, y: 0 };
  const scaled = Math.min((len - deadzone) / (1 - deadzone), 1);
  return { x: (raw.x / len) * scaled, y: (raw.y / len) * scaled };
}

/** 각도를 -PI..PI 범위로 감는다. */
export function wrapAngle(angle: number): number {
  let a = (angle + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** 현재 각도에서 목표 각도로 최대 maxStep 만큼만 돌린다. */
export function rotateToward(current: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxStep);
}
