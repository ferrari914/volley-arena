import { clamp, length, type Vec2 } from '../core/math';
import type { Obstacle } from '../entities/types';
import { pushOutOfObstacles } from './obstacles';

/**
 * 이동 입력을 받아 새 위치를 돌려준다.
 * 아레나 밖으로는 나가지 못하게 원 안쪽으로 밀어 넣는다.
 * (벽을 따라 미끄러지도록 각도는 유지하고 반지름만 자른다)
 *
 * 기둥(DESIGN 10번)도 같은 규칙으로 막는다 — 밖으로 밀어내므로 비스듬히 닿으면
 * 미끄러져 지나간다. **벽을 먼저 자르고 기둥을 나중에 민다**: 순서를 뒤집으면
 * 벽에 붙어 선 기둥이 몸을 아레나 밖으로 밀어낼 수 있다.
 */
export function movePlayer(
  pos: Vec2,
  move: Vec2,
  dt: number,
  speed: number,
  arenaRadius: number,
  bodyRadius: number,
  obstacles: readonly Obstacle[] = [],
): Vec2 {
  const next = { x: pos.x + move.x * speed * dt, y: pos.y + move.y * speed * dt };
  const limit = Math.max(arenaRadius - bodyRadius, 0);
  const dist = length(next);
  const inArena =
    dist <= limit
      ? next
      : dist < 1e-6
        ? { x: 0, y: 0 }
        : { x: (next.x * limit) / dist, y: (next.y * limit) / dist };
  return pushOutOfObstacles(inArena, bodyRadius, obstacles);
}

/** 스틱 값을 화면 기준에서 월드 XZ 기준으로 바꾼다. 스틱 위(-y)가 월드 앞(-z)이다. */
export function stickToWorld(stick: Vec2): Vec2 {
  return { x: clamp(stick.x, -1, 1), y: clamp(stick.y, -1, 1) };
}
