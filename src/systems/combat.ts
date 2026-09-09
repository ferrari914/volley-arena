import { clamp, length, type Vec2 } from '../core/math';
import type { Arrow, Target } from '../entities/types';

/**
 * 선분 a→b 위에서 점 c까지의 최단 거리의 제곱.
 * 화살은 한 프레임에 자기 몸통보다 멀리 날아가므로, 위치만 비교하면
 * 대상을 통과해도 지나쳐 버린다. 이동 궤적 전체로 판정한다.
 */
export function segmentPointDistanceSq(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq < 1e-12 ? 0 : clamp(((c.x - a.x) * abx + (c.y - a.y) * aby) / lenSq, 0, 1);
  const dx = a.x + abx * t - c.x;
  const dy = a.y + aby * t - c.y;
  return dx * dx + dy * dy;
}

export interface ArrowStepOptions {
  dt: number;
  arenaRadius: number;
  arrowRadius: number;
  targetRadius: number;
  lifetime: number;
  respawnDelay: number;
}

export interface ArrowStepResult {
  /** 이번 스텝에 대상을 맞힌 횟수. */
  hits: number;
  /**
   * 쓰러진 자리들. 경험치 코어가 여기에 떨어진다(3번).
   * 위치를 여기서 돌려주지 않으면 World가 "어느 대상이 방금 죽었는지"를
   * 다시 훑어야 한다 — 판정은 이미 이 안에서 끝났으므로 그 자리에서 알려 준다.
   */
  hitPoints: Vec2[];
}

/**
 * 화살을 한 스텝 움직이고, 궤적이 대상을 스쳤는지 본다.
 * 죽은 화살은 배열에서 지우지 않고 alive=false 로 두고, 호출한 쪽이 정리한다
 * (렌더러가 같은 프레임에 메시를 회수해야 하기 때문).
 */
export function stepArrows(
  arrows: Arrow[],
  targets: Target[],
  options: ArrowStepOptions,
): ArrowStepResult {
  const { dt, arenaRadius, arrowRadius, targetRadius, lifetime, respawnDelay } = options;
  const hitRadiusSq = (arrowRadius + targetRadius) ** 2;
  const hitPoints: Vec2[] = [];
  let hits = 0;

  for (const arrow of arrows) {
    if (!arrow.alive) continue;
    const from = { x: arrow.pos.x, y: arrow.pos.y };
    const to = { x: from.x + arrow.vel.x * dt, y: from.y + arrow.vel.y * dt };
    arrow.pos = to;
    arrow.age += dt;

    for (const target of targets) {
      if (!target.alive) continue;
      if (segmentPointDistanceSq(from, to, target.pos) <= hitRadiusSq) {
        target.alive = false;
        target.respawnTimer = respawnDelay;
        target.hitFlash = 1;
        arrow.alive = false;
        hits += 1;
        hitPoints.push({ x: target.pos.x, y: target.pos.y });
        break;
      }
    }

    if (!arrow.alive) continue;
    if (arrow.age >= lifetime || length(arrow.pos) > arenaRadius) {
      arrow.alive = false;
    }
  }

  return { hits, hitPoints };
}

/** 쓰러진 대상을 제자리에 다시 세운다. */
export function stepTargets(targets: Target[], dt: number): void {
  for (const target of targets) {
    if (target.hitFlash > 0) target.hitFlash = Math.max(0, target.hitFlash - dt * 2.5);
    if (target.alive) continue;
    target.respawnTimer -= dt;
    if (target.respawnTimer <= 0) {
      target.alive = true;
      target.pos = { x: target.home.x, y: target.home.y };
      target.respawnTimer = 0;
    }
  }
}
