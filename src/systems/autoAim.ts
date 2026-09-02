import { distanceSq, type Vec2 } from '../core/math';
import type { Target } from '../entities/types';

/**
 * 사거리 안에서 가장 가까운 살아있는 대상을 고른다.
 * 없으면 null — 이때는 마지막으로 보던 방향을 유지한다.
 */
export function findNearestTarget(from: Vec2, targets: readonly Target[], range: number): Target | null {
  let best: Target | null = null;
  let bestDistSq = range * range;
  for (const target of targets) {
    if (!target.alive) continue;
    const d = distanceSq(from, target.pos);
    if (d <= bestDistSq) {
      bestDistSq = d;
      best = target;
    }
  }
  return best;
}
