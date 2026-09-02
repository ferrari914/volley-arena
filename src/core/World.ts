import { AIM, ARENA, ARROW, PLAYER, TARGET } from '../data/config';
import { createPlayer, createTarget, type Arrow, type Player, type Target } from '../entities/types';
import { normalize, rotateToward, type Vec2 } from './math';
import { findNearestTarget } from '../systems/autoAim';
import { stepArrows, stepTargets } from '../systems/combat';
import { movePlayer } from '../systems/movement';

export interface FrameInput {
  /** 이동 입력. 길이 0~1. y는 월드 Z축(화면 위가 -y). */
  move: Vec2;
  /** 수동 조준 방향. 손을 대지 않았으면 null → 자동 조준. */
  aim: Vec2 | null;
}

/** 표준 대상 배치. 자동 조준이 "가장 가까운" 것을 고르는지 눈으로 보이게 흩어 둔다. */
const TARGET_LAYOUT: readonly Vec2[] = [
  { x: 0, y: -13 },
  { x: 12, y: 6 },
  { x: -12, y: 6 },
  { x: 18, y: -9 },
  { x: -18, y: -9 },
];

/**
 * 순수 시뮬레이션. Three.js를 알지 못한다.
 * 렌더러가 없어도 돌아가므로 테스트에서 그대로 쓸 수 있다.
 */
export class World {
  readonly player: Player = createPlayer();
  readonly arrows: Arrow[] = [];
  readonly targets: Target[] = TARGET_LAYOUT.map((p) => createTarget(p.x, p.y));

  /** 살아온 시간(s). */
  elapsed = 0;
  /** 명중 횟수. 7번(결과 화면)에서 그대로 쓴다. */
  hits = 0;
  /** 지금 자동 조준이 잡고 있는 대상. 없으면 null. */
  lockedTarget: Target | null = null;

  private manualAimHold = 0;
  private nextArrowId = 1;

  /** 고정 시간 간격으로 호출된다. dt는 항상 같은 값이다. */
  step(input: FrameInput, dt: number): void {
    this.elapsed += dt;

    this.player.pos = movePlayer(
      this.player.pos,
      input.move,
      dt,
      PLAYER.speed,
      ARENA.radius,
      PLAYER.radius,
    );

    this.updateAim(input, dt);
    this.updateFiring(dt);

    const result = stepArrows(this.arrows, this.targets, {
      dt,
      arenaRadius: ARENA.radius,
      arrowRadius: ARROW.radius,
      targetRadius: TARGET.radius,
      lifetime: ARROW.lifetime,
      respawnDelay: TARGET.respawnDelay,
    });
    this.hits += result.hits;

    stepTargets(this.targets, dt);
    this.removeDeadArrows();
  }

  /** 조준: 수동 입력이 있으면 그쪽, 없으면 가장 가까운 대상. */
  private updateAim(input: FrameInput, dt: number): void {
    let desired: number | null = null;

    if (input.aim) {
      const dir = normalize(input.aim);
      if (dir.x !== 0 || dir.y !== 0) {
        desired = Math.atan2(dir.y, dir.x);
        this.manualAimHold = AIM.manualHold;
        this.lockedTarget = null;
      }
    } else if (this.manualAimHold > 0) {
      // 손가락을 뗀 직후에 방향이 홱 돌아가지 않도록 잠깐 붙잡아 둔다.
      this.manualAimHold -= dt;
    }

    if (desired === null && this.manualAimHold <= 0) {
      const target = findNearestTarget(this.player.pos, this.targets, AIM.autoRange);
      this.lockedTarget = target;
      if (target) {
        desired = Math.atan2(target.pos.y - this.player.pos.y, target.pos.x - this.player.pos.x);
      }
    }

    if (desired !== null) {
      this.player.facing = rotateToward(this.player.facing, desired, PLAYER.turnRate * dt);
    }
  }

  private updateFiring(dt: number): void {
    this.player.fireCooldown -= dt;
    if (this.player.fireCooldown > 0) return;
    this.player.fireCooldown += ARROW.cooldown;
    this.spawnArrow();
  }

  private spawnArrow(): void {
    const dir = { x: Math.cos(this.player.facing), y: Math.sin(this.player.facing) };
    this.arrows.push({
      id: this.nextArrowId++,
      pos: {
        x: this.player.pos.x + dir.x * ARROW.muzzleOffset,
        y: this.player.pos.y + dir.y * ARROW.muzzleOffset,
      },
      vel: { x: dir.x * ARROW.speed, y: dir.y * ARROW.speed },
      age: 0,
      alive: true,
    });
  }

  private removeDeadArrows(): void {
    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      if (!this.arrows[i]?.alive) this.arrows.splice(i, 1);
    }
  }
}
