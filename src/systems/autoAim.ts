import { distanceSq, type Vec2 } from '../core/math';
import type { Enemy } from '../entities/types';

/**
 * 사거리 안에서 가장 가까운 살아있는 적을 고른다.
 * 없으면 null — 이때는 마지막으로 보던 방향을 유지한다.
 *
 * `excludeId`는 튕김(DESIGN 8번)이 쓴다. 방금 맞힌 놈에게 도로 튕겨 가면
 * 화살이 제자리에서 떠는 것으로 보이므로, 그 하나만 빼고 다음 상대를 찾는다.
 */
export function findNearestEnemy(
  from: Vec2,
  enemies: readonly Enemy[],
  range: number,
  excludeId?: number,
): Enemy | null {
  let best: Enemy | null = null;
  let bestDistSq = range * range;
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.id === excludeId) continue;
    const d = distanceSq(from, enemy.pos);
    if (d <= bestDistSq) {
      bestDistSq = d;
      best = enemy;
    }
  }
  return best;
}
