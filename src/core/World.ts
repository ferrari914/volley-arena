import { AIM, ARENA, ARROW, CORE, LEVEL, PLAYER, TARGET } from '../data/config';
import {
  createPlayer,
  createTarget,
  createXpCore,
  type Arrow,
  type Player,
  type Progress,
  type Target,
  type XpCore,
} from '../entities/types';
import { normalize, rotateToward, type Vec2 } from './math';
import { findNearestTarget } from '../systems/autoAim';
import { stepArrows, stepTargets } from '../systems/combat';
import {
  createDropCores,
  createProgress,
  gainXp,
  pickAmbientSpawn,
  stepCores,
} from '../systems/experience';
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

export interface WorldOptions {
  /** 대상이 설 자리. 생략하면 표준 배치. 부하 측정 장면이 여기로 20개를 세운다. */
  targets?: readonly Vec2[];
  /**
   * 난수 씨앗. 코어가 생기는 자리에만 쓴다.
   * 씨앗을 고정해 두는 이유: 성능 측정(`npm run perf`)과 테스트가 바퀴마다
   * 같은 장면을 봐야 수치를 비교할 수 있다. Math.random을 쓰면 그게 무너진다.
   */
  seed?: number;
}

/** 씨앗 고정 난수(LCG). 시뮬레이션은 스스로 재현할 수 있어야 한다. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 순수 시뮬레이션. Three.js를 알지 못한다.
 * 렌더러가 없어도 돌아가므로 테스트에서 그대로 쓸 수 있다.
 */
export class World {
  readonly player: Player = createPlayer();
  readonly arrows: Arrow[] = [];
  readonly targets: Target[];
  readonly cores: XpCore[] = [];

  /** 살아온 시간(s). */
  elapsed = 0;
  /** 명중 횟수. 7번(결과 화면)에서 그대로 쓴다. */
  hits = 0;
  /** 지금 자동 조준이 잡고 있는 대상. 없으면 null. */
  lockedTarget: Target | null = null;

  /** 레벨과 경험치. */
  readonly progress: Progress = createProgress(LEVEL);
  /**
   * 출처별로 모은 경험치. 화면에는 쓰지 않고, 밸런스를 재는 쪽이 본다
   * ("적을 잡는 쪽이 확실히 빠른가" — DESIGN 3번).
   */
  readonly xpByOrigin = { ambient: 0, drop: 0 };
  /**
   * 이번 스텝에 오른 레벨 수. 4번(3중 1택)이 이 값을 보고 카드를 띄우고 게임을 멈춘다.
   * 매 스텝 0으로 초기화되므로 프레임을 건너뛰면 놓친다 — 4번에서는 큐로 바꾼다.
   */
  levelUps = 0;

  private manualAimHold = 0;
  private nextArrowId = 1;
  private nextCoreId = 1;
  private ambientTimer = CORE.ambient.spawnInterval;
  private readonly random: () => number;

  constructor(options: WorldOptions = {}) {
    this.targets = (options.targets ?? TARGET_LAYOUT).map((p) => createTarget(p.x, p.y));
    this.random = makeRandom(options.seed ?? 20260909);
    for (let i = 0; i < CORE.ambient.initial; i += 1) this.spawnAmbientCore();
  }

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
    for (const point of result.hitPoints) this.dropCores(point);

    stepTargets(this.targets, dt);
    this.updateCores(dt);
    this.removeDeadArrows();
  }

  /** 코어: 끌려오기·줍기·수명, 그리고 맵에 저절로 생기는 몫. */
  private updateCores(dt: number): void {
    const gained = stepCores(this.cores, {
      dt,
      playerPos: this.player.pos,
      pickupRadius: PLAYER.radius + CORE.radius,
      magnetRadius: CORE.magnetRadius,
      magnetSpeed: CORE.magnetSpeed,
    });
    this.xpByOrigin.ambient += gained.ambient;
    this.xpByOrigin.drop += gained.drop;
    this.levelUps = gainXp(this.progress, gained.ambient + gained.drop, LEVEL);

    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer += CORE.ambient.spawnInterval;
      if (this.countAmbient() < CORE.ambient.max) {
        this.spawnAmbientCore();
        // 여기서도 상한을 지킨다. 안 그러면 난전 중에 상한을 한 개씩 넘어선다.
        this.trimCores();
      }
    }

    this.removeDeadCores();
  }

  private countAmbient(): number {
    let count = 0;
    for (const core of this.cores) {
      if (core.alive && core.origin === 'ambient') count += 1;
    }
    return count;
  }

  private spawnAmbientCore(): void {
    const pos = pickAmbientSpawn(this.random, this.player.pos, {
      arenaRadius: ARENA.radius,
      edgeMargin: CORE.ambient.edgeMargin,
      minPlayerDistance: CORE.ambient.minPlayerDistance,
    });
    // 맵에 놓인 코어는 스스로 사라지지 않는다. 걸어가는 사이에 없어지면 주우러 갈 이유가 없다.
    this.cores.push(createXpCore(this.nextCoreId++, pos, CORE.ambient.value, 'ambient', Infinity));
  }

  private dropCores(at: Vec2): void {
    const dropped = createDropCores(at, () => this.nextCoreId++, this.random, {
      count: CORE.drop.perKill,
      value: CORE.drop.value,
      lifetime: CORE.drop.lifetime,
      scatter: CORE.drop.scatter,
      limitRadius: ARENA.radius - 0.6,
    });
    this.cores.push(...dropped);
    this.trimCores();
  }

  /**
   * 코어 수 상한을 지킨다. 넘치면 앞쪽(=가장 오래된) 드롭부터 버린다.
   * 맵에 놓인 코어는 남긴다 — 그쪽은 개수가 이미 고정이고, 걸어가던 목표가
   * 눈앞에서 사라지는 쪽이 훨씬 나쁘다.
   */
  private trimCores(): void {
    let excess = this.cores.length - CORE.maxAlive;
    if (excess <= 0) return;
    for (const core of this.cores) {
      if (excess <= 0) break;
      if (core.origin !== 'drop' || !core.alive) continue;
      core.alive = false;
      excess -= 1;
    }
  }

  private removeDeadCores(): void {
    for (let i = this.cores.length - 1; i >= 0; i -= 1) {
      if (!this.cores[i]?.alive) this.cores.splice(i, 1);
    }
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

  /**
   * 화살 하나를 장전한다. 쏘는 지점과 방향만 받는다.
   * 발사 규칙(쿨다운·조준)을 거치지 않는 유일한 입구다 —
   * 8번 다중 발사와 부하 측정 장면이 둘 다 여기로 들어온다.
   */
  addArrow(pos: Vec2, dir: Vec2): void {
    const d = normalize(dir);
    if (d.x === 0 && d.y === 0) return;
    this.arrows.push({
      id: this.nextArrowId++,
      pos: { x: pos.x, y: pos.y },
      vel: { x: d.x * ARROW.speed, y: d.y * ARROW.speed },
      age: 0,
      alive: true,
    });
  }

  private spawnArrow(): void {
    const dir = { x: Math.cos(this.player.facing), y: Math.sin(this.player.facing) };
    this.addArrow(
      {
        x: this.player.pos.x + dir.x * ARROW.muzzleOffset,
        y: this.player.pos.y + dir.y * ARROW.muzzleOffset,
      },
      dir,
    );
  }

  private removeDeadArrows(): void {
    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      if (!this.arrows[i]?.alive) this.arrows.splice(i, 1);
    }
  }
}
