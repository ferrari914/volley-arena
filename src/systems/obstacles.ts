import { segmentPointDistanceSq, type Vec2 } from '../core/math';
import type { Obstacle } from '../entities/types';

/**
 * 기둥(DESIGN 10번 · 장애물)이 게임에 거는 규칙은 셋뿐이고, 전부 여기에 있다.
 *
 *   1. **몸은 못 지나간다** (`pushOutOfObstacles`) — 플레이어도 적도 같은 함수를 쓴다.
 *   2. **화살은 막힌다** (`blockedByObstacles`) — 주인이 누구든 똑같이 막힌다.
 *   3. **아무것도 기둥 속에 놓이지 않는다** (`insideObstacle`) — 코어·증원 자리.
 *
 * 적이 "지금 플레이어가 보이는가"를 묻는 자(`sightBlocker`)도 여기 있다. 2번과 같은 선을
 * 같은 굵기로 재되 **누가 막았는지**까지 돌려준다 — 돌아설 쪽을 정하는 데 그것이 필요하다.
 *
 * **세 규칙이 한 파일에 있어야 하는 이유**: 하나라도 빠지면 기둥이 거짓말을 한다.
 * 몸만 막고 화살을 안 막으면 숨을 곳이 아니라 걸리적거리는 것이 되고,
 * 화살만 막고 자리 고르기를 안 보면 기둥 속에 코어가 생겨 영영 못 줍는다.
 *
 * 기둥이 없는 맵(`open`)에서는 세 함수 모두 첫 줄에서 빠져나온다 — 배열이 비어 있으면
 * 반복이 돌지 않는다. 그래서 기둥 없는 맵의 수치는 이 파일이 생기기 전과 한 줄도 다르지 않다.
 */

/**
 * 기둥 속에 파묻힌 몸을 가장 가까운 바깥으로 밀어낸다.
 *
 * **미는 방향은 기둥 중심에서 밖으로다.** 들어온 방향으로 되돌리지 않는 이유:
 * 되돌리면 기둥에 닿는 순간 발이 묶여 벽을 따라 미끄러지지 못한다. 밖으로 밀면
 * 비스듬히 온 몸은 옆으로 미끄러져 지나간다 — 아레나 벽(`movePlayer`)과 같은 규칙이다.
 *
 * 여러 기둥에 동시에 걸릴 수 있으므로 차례로 민다. 기둥 둘이 겹쳐 서 있으면
 * 그 사이에 낄 수 있지만, 맵 데이터가 겹치지 않게 두면 생기지 않는 일이다
 * (`tests/maps.test.ts`가 그것을 지킨다).
 */
export function pushOutOfObstacles(
  pos: Vec2,
  bodyRadius: number,
  obstacles: readonly Obstacle[],
): Vec2 {
  if (obstacles.length === 0) return pos;
  let out = pos;
  for (const pillar of obstacles) {
    const limit = pillar.radius + bodyRadius;
    const dx = out.x - pillar.x;
    const dy = out.y - pillar.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= limit) continue;
    // 정확히 중심에 선 경우(거리 0)에는 밀 방향이 없다. 한 방향을 골라 밀어낸다 —
    // 그대로 두면 몸이 기둥 속에 영영 갇힌다.
    if (dist < 1e-6) {
      out = { x: pillar.x + limit, y: pillar.y };
      continue;
    }
    out = { x: pillar.x + (dx / dist) * limit, y: pillar.y + (dy / dist) * limit };
  }
  return out;
}

/**
 * 이번 프레임에 from→to로 나아간 화살이 기둥에 닿았는가.
 *
 * 점이 아니라 **선분으로** 재는 이유는 적을 맞히는 판정과 같다 — 화살은 한 프레임에
 * 제 몸통보다 멀리 나아가서, 위치만 보면 얇은 기둥을 그냥 통과한다.
 */
export function blockedByObstacles(
  from: Vec2,
  to: Vec2,
  arrowRadius: number,
  obstacles: readonly Obstacle[],
): boolean {
  for (const pillar of obstacles) {
    const limit = pillar.radius + arrowRadius;
    if (segmentPointDistanceSq(from, to, pillar) <= limit * limit) return true;
  }
  return false;
}

/**
 * from→to 사이를 막고 있는 기둥 중 **from에 가장 가까운 것**. 막는 것이 없으면 null.
 *
 * `blockedByObstacles`가 "막혔는가"만 돌려주는 데 반해 이것은 **누가 막았는지**를 돌려준다.
 * 적이 시야를 되찾으려면 어느 쪽으로 돌아야 하는지를 알아야 하고, 그것을 정하는 것이
 * 막은 기둥의 자리이기 때문이다(`systems/enemyAi.ts`의 `clearSightMove`).
 *
 * **가장 가까운 것을 고르는 이유**: 둘이 겹쳐 막고 있으면 뒤엣것을 돌아 봐야 앞엣것에
 * 여전히 막힌다. 앞엣것부터 벗어나야 한 걸음이 실제로 시야를 연다.
 *
 * 화살이 막히는 판정(`blockedByObstacles`)과 **같은 자와 같은 굵기로 잰다** —
 * 여기서 다르게 재면 적이 "보인다"고 믿고 쏜 화살이 기둥에 박히거나, 그 반대가 된다.
 */
export function sightBlocker(
  from: Vec2,
  to: Vec2,
  arrowRadius: number,
  obstacles: readonly Obstacle[],
): Obstacle | null {
  let nearest: Obstacle | null = null;
  let nearestSq = Infinity;
  for (const pillar of obstacles) {
    const limit = pillar.radius + arrowRadius;
    if (segmentPointDistanceSq(from, to, pillar) > limit * limit) continue;
    const dx = pillar.x - from.x;
    const dy = pillar.y - from.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= nearestSq) continue;
    nearestSq = distSq;
    nearest = pillar;
  }
  return nearest;
}

/**
 * 이 자리가 기둥 속(또는 `margin`만큼 가까운 곳)인가.
 * 코어가 생길 자리와 증원이 걸어 들어올 자리를 고를 때 본다.
 */
export function insideObstacle(
  pos: Vec2,
  margin: number,
  obstacles: readonly Obstacle[],
): boolean {
  for (const pillar of obstacles) {
    const limit = pillar.radius + margin;
    const dx = pos.x - pillar.x;
    const dy = pos.y - pillar.y;
    if (dx * dx + dy * dy < limit * limit) return true;
  }
  return false;
}
