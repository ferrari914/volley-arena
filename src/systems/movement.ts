import { clamp, length, type Vec2 } from '../core/math';
import type { Obstacle } from '../entities/types';
import { pushOutOfObstacles } from './obstacles';

/**
 * 몸 하나를 설 수 있는 자리에 앉힌다. 아레나 밖으로는 나가지 못하게 원 안쪽으로
 * 밀어 넣고(벽을 따라 미끄러지도록 각도는 유지하고 반지름만 자른다), 기둥
 * (DESIGN 10번)에서도 밀어낸다 — 밖으로 밀어내므로 비스듬히 닿으면 미끄러져 지나간다.
 *
 * **벽을 먼저 자르고 기둥을 나중에 민다**: 순서를 뒤집으면 벽에 붙어 선 기둥이
 * 몸을 아레나 밖으로 밀어낼 수 있다.
 *
 * **몸을 옮기는 곳은 전부 이 함수를 지난다** — 걸어가는 플레이어(`movePlayer`)도,
 * 걸어오는 적(`systems/enemyAi.ts`의 `moveBy`)도, 화살에 밀린 적
 * (`systems/combat.ts`의 밀어내기 카드)도. 자리를 자르는 규칙이 갈라지면
 * "여기는 벽을 뚫는다"는 고장이 옮기는 길마다 따로 생긴다.
 */
export function settleBody(
  pos: Vec2,
  arenaRadius: number,
  bodyRadius: number,
  obstacles: readonly Obstacle[] = [],
): Vec2 {
  const limit = Math.max(arenaRadius - bodyRadius, 0);
  const dist = length(pos);
  const inArena =
    dist <= limit
      ? pos
      : dist < 1e-6
        ? { x: 0, y: 0 }
        : { x: (pos.x * limit) / dist, y: (pos.y * limit) / dist };
  return pushOutOfObstacles(inArena, bodyRadius, obstacles);
}

/** 이동 입력을 받아 새 위치를 돌려준다. 자리를 자르는 것은 `settleBody`가 한다. */
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
  return settleBody(next, arenaRadius, bodyRadius, obstacles);
}

/** 스틱 값을 화면 기준에서 월드 XZ 기준으로 바꾼다. 스틱 위(-y)가 월드 앞(-z)이다. */
export function stickToWorld(stick: Vec2): Vec2 {
  return { x: clamp(stick.x, -1, 1), y: clamp(stick.y, -1, 1) };
}
