import { distanceSq, type Vec2 } from '../core/math';
import type { Enemy } from '../entities/types';

/**
 * 사거리 안에서 가장 가까운 살아있는 적을 고른다.
 * 없으면 null — 이때는 마지막으로 보던 방향을 유지한다.
 */
export function findNearestEnemy(from: Vec2, enemies: readonly Enemy[], range: number): Enemy | null {
  let best: Enemy | null = null;
  let bestDistSq = range * range;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const d = distanceSq(from, enemy.pos);
    if (d <= bestDistSq) {
      bestDistSq = d;
      best = enemy;
    }
  }
  return best;
}
