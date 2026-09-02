import { clamp, length, type Vec2 } from '../core/math';

/**
 * 이동 입력을 받아 새 위치를 돌려준다.
 * 아레나 밖으로는 나가지 못하게 원 안쪽으로 밀어 넣는다.
 * (벽을 따라 미끄러지도록 각도는 유지하고 반지름만 자른다)
 */
export function movePlayer(
  pos: Vec2,
  move: Vec2,
  dt: number,
  speed: number,
  arenaRadius: number,
  bodyRadius: number,
): Vec2 {
  const next = { x: pos.x + move.x * speed * dt, y: pos.y + move.y * speed * dt };
  const limit = Math.max(arenaRadius - bodyRadius, 0);
  const dist = length(next);
  if (dist <= limit) return next;
  if (dist < 1e-6) return { x: 0, y: 0 };
  const scale = limit / dist;
  return { x: next.x * scale, y: next.y * scale };
}

/** 스틱 값을 화면 기준에서 월드 XZ 기준으로 바꾼다. 스틱 위(-y)가 월드 앞(-z)이다. */
export function stickToWorld(stick: Vec2): Vec2 {
  return { x: clamp(stick.x, -1, 1), y: clamp(stick.y, -1, 1) };
}
