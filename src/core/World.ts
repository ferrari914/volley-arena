import { AIM, ARENA, ARROW, CORE, ENEMY, LEVEL, PLAYER, UPGRADE } from '../data/config';
import { UPGRADE_CARDS } from '../data/upgrades';
import {
  createEnemy,
  createPlayer,
  createXpCore,
  type Arrow,
  type ArrowOwner,
  type Enemy,
  type Player,
  type PlayerStats,
  type Progress,
  type UpgradeOffer,
  type XpCore,
} from '../entities/types';
import { normalize, rotateToward, type Vec2 } from './math';
import { findNearestEnemy } from '../systems/autoAim';
import { stepArrows, stepPlayerRecovery } from '../systems/combat';
import { stepEnemies } from '../systems/enemyAi';
import {
  createDropCores,
  createProgress,
  gainXp,
  pickAmbientSpawn,
  stepCores,
} from '../systems/experience';
import { movePlayer } from '../systems/movement';
import { applyUpgrade, rollUpgradeChoices } from '../systems/upgrades';

export interface FrameInput {
  /** 이동 입력. 길이 0~1. y는 월드 Z축(화면 위가 -y). */
  move: Vec2;
  /** 수동 조준 방향. 손을 대지 않았으면 null → 자동 조준. */
  aim: Vec2 | null;
}

/**
 * 표준 적 배치. 자동 조준이 "가장 가까운" 것을 고르는지 눈으로 보이게 흩어 둔다.
 * 적은 쓰러지면 이 자리로 돌아와 다시 선다 — 플레이어에게서 먼 자리라 숨 돌릴 틈이 생긴다.
 */
const ENEMY_LAYOUT: readonly Vec2[] = [
  { x: 0, y: -13 },
  { x: 12, y: 6 },
  { x: -12, y: 6 },
  { x: 18, y: -9 },
  { x: -18, y: -9 },
];

export interface WorldOptions {
  /** 적이 설 자리. 생략하면 표준 배치. 부하 측정 장면이 여기로 20마리를 세운다. */
  enemies?: readonly Vec2[];
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
  readonly player: Player = createPlayer(PLAYER.maxHp);
  readonly arrows: Arrow[] = [];
  readonly enemies: Enemy[];
  readonly cores: XpCore[] = [];

  /** 살아온 시간(s). */
  elapsed = 0;
  /** 적을 맞힌 횟수. 적에게 체력이 생긴 뒤로는 처치 수와 다르다. */
  hits = 0;
  /** 쓰러뜨린 적의 수. HUD의 "처치"이자 7번(결과 화면)이 그대로 쓸 값이다. */
  kills = 0;
  /** 지금 자동 조준이 잡고 있는 적. 없으면 null. */
  lockedEnemy: Enemy | null = null;

  /**
   * 플레이어가 쓰러졌는가. true가 되면 `step()`은 아무 일도 하지 않는다 —
   * 카드가 떠 있을 때와 같은 규칙이다(멈춤은 부르는 쪽이 아니라 World가 지킨다).
   * 여기서 이어지는 리스폰·부활은 DESIGN 6번의 일이다.
   */
  defeated = false;

  /** 레벨과 경험치. */
  readonly progress: Progress = createProgress(LEVEL);
  /**
   * 출처별로 모은 경험치. 화면에는 쓰지 않고, 밸런스를 재는 쪽이 본다
   * ("적을 잡는 쪽이 확실히 빠른가" — DESIGN 3번).
   */
  readonly xpByOrigin = { ambient: 0, drop: 0 };
  /**
   * 업그레이드로 바뀌는 능력치. 시작값은 config에서 온다.
   * 이동·발사·코어 끌어당김이 전부 여기를 본다 — 카드가 실제로 게임을 바꾸는 통로다.
   */
  stats: PlayerStats = {
    fireCooldown: ARROW.cooldown,
    moveSpeed: PLAYER.speed,
    magnetRadius: CORE.magnetRadius,
    xpMultiplier: 1,
  };

  /** 카드별로 몇 번 골랐는지. 다음 제시에서 최대치에 닿은 카드를 빼는 데 쓴다. */
  readonly upgradeStacks: Record<string, number> = {};

  /** 고른 순서대로 쌓인 카드 id. 결과 화면(7번)이 "무엇으로 강해졌는가"를 보여줄 때 쓴다. */
  readonly takenUpgrades: string[] = [];

  /**
   * 지금 떠 있는 3중 1택. null이 아닌 동안 `step()`은 아무 일도 하지 않는다 —
   * 그것이 DESIGN 4번의 "그동안 게임은 멈춘다"이다.
   */
  offer: UpgradeOffer | null = null;

  /**
   * 아직 카드를 고르지 않은 레벨업 수. **덮어쓰지 않고 쌓는다.**
   * 한 스텝에 두 레벨이 올라도, 카드를 고르는 동안 다음 레벨업이 겹쳐도 하나도 잃지 않는다.
   */
  private pendingLevelUps = 0;

  private manualAimHold = 0;
  private nextArrowId = 1;
  private nextEnemyId = 1;
  private nextCoreId = 1;
  private ambientTimer = CORE.ambient.spawnInterval;
  private readonly random: () => number;

  constructor(options: WorldOptions = {}) {
    this.enemies = (options.enemies ?? ENEMY_LAYOUT).map((p) =>
      createEnemy(this.nextEnemyId++, p.x, p.y, ENEMY.maxHp),
    );
    this.random = makeRandom(options.seed ?? 20260909);
    for (let i = 0; i < CORE.ambient.initial; i += 1) this.spawnAmbientCore();
  }

  /** 카드가 떠 있거나 쓰러졌는가. 둘 중 하나면 게임은 멈춰 있다. */
  get isPaused(): boolean {
    return this.offer !== null || this.defeated;
  }

  /** 아직 고르지 않은 레벨업 수. 화면과 테스트가 "놓친 레벨업이 없다"를 확인한다. */
  get pendingUpgrades(): number {
    return this.pendingLevelUps;
  }

  /** 고정 시간 간격으로 호출된다. dt는 항상 같은 값이다. */
  step(input: FrameInput, dt: number): void {
    // 카드를 고르는 동안과 쓰러진 뒤에는 시간도 흐르지 않는다. 부르는 쪽이 깜빡해도
    // 게임이 흘러가지 않도록 멈춤을 여기서 지킨다 — 화면은 계속 그려야 하므로
    // 멈추는 것은 시뮬레이션뿐이다.
    if (this.offer || this.defeated) return;

    this.elapsed += dt;

    this.player.pos = movePlayer(
      this.player.pos,
      input.move,
      dt,
      this.stats.moveSpeed,
      ARENA.radius,
      PLAYER.radius,
    );

    this.updateAim(input, dt);
    this.updateFiring(dt);
    stepPlayerRecovery(this.player, dt);

    // 적이 먼저 쏘고 그 화살까지 이번 스텝에 함께 움직인다.
    // 순서를 뒤집으면 적이 쏜 화살이 한 프레임 동안 총구에 붙어 있다.
    for (const shot of this.updateEnemies(dt)) this.addArrow(shot.pos, shot.dir, 'enemy');

    const result = stepArrows(this.arrows, {
      dt,
      arenaRadius: ARENA.radius,
      arrowRadius: ARROW.radius,
      enemyRadius: ENEMY.radius,
      playerRadius: PLAYER.radius,
      invulnerable: PLAYER.invulnerable,
      respawnDelay: ENEMY.respawnDelay,
      player: this.player,
      enemies: this.enemies,
    });
    this.hits += result.hits;
    this.kills += result.kills;
    for (const point of result.killPoints) this.dropCores(point);

    this.updateCores(dt);
    this.removeDeadArrows();

    // 체력이 다하면 여기서 판이 끝난다. 스텝의 나머지를 다 돌린 뒤에 판정하는 이유:
    // 마지막 한 발이 적을 쓰러뜨렸다면 그 처치도 기록에 남아야 한다.
    if (this.player.hp <= 0) this.defeated = true;

    // 레벨이 올랐으면 카드를 띄운다. 스텝의 마지막이어야 이번 스텝의 이동·명중이
    // 모두 반영된 뒤에 멈춘다(카드가 뜬 프레임에 화살이 허공에서 멈추지 않는다).
    if (!this.offer && this.pendingLevelUps > 0) this.openOffer();
  }

  /** 적을 한 스텝 움직인다. 돌려받은 것은 이번에 적이 쏜 화살들이다. */
  private updateEnemies(dt: number) {
    return stepEnemies(this.enemies, {
      dt,
      playerPos: this.player.pos,
      playerAlive: this.player.hp > 0,
      arenaRadius: ARENA.radius,
      bodyRadius: ENEMY.radius,
      speed: ENEMY.speed,
      turnRate: ENEMY.turnRate,
      respawnDelay: ENEMY.respawnDelay,
      fireRange: ENEMY.fireRange,
      approachDistance: ENEMY.approachDistance,
      keepDistance: ENEMY.keepDistance,
      strafeRatio: ENEMY.strafeRatio,
      separation: ENEMY.separation,
      aimTime: ENEMY.aimTime,
      fireCooldown: ENEMY.fireCooldown,
      spread: ENEMY.spread,
      muzzleOffset: ENEMY.arrow.muzzleOffset,
      random: this.random,
    });
  }

  /** 코어: 끌려오기·줍기·수명, 그리고 맵에 저절로 생기는 몫. */
  private updateCores(dt: number): void {
    const gained = stepCores(this.cores, {
      dt,
      playerPos: this.player.pos,
      pickupRadius: PLAYER.radius + CORE.radius,
      magnetRadius: this.stats.magnetRadius,
      magnetSpeed: CORE.magnetSpeed,
    });
    // 경험치 배율은 두 출처에 똑같이 곱한다. 한쪽에만 곱하면 3번에서 못 박은
    // "전투가 채집보다 빠르다"는 비율이 카드 몇 장에 흔들린다.
    const ambient = gained.ambient * this.stats.xpMultiplier;
    const drop = gained.drop * this.stats.xpMultiplier;
    this.xpByOrigin.ambient += ambient;
    this.xpByOrigin.drop += drop;
    this.pendingLevelUps += gainXp(this.progress, ambient + drop, LEVEL);

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

  /** 조준: 수동 입력이 있으면 그쪽, 없으면 가장 가까운 적. */
  private updateAim(input: FrameInput, dt: number): void {
    let desired: number | null = null;

    if (input.aim) {
      const dir = normalize(input.aim);
      if (dir.x !== 0 || dir.y !== 0) {
        desired = Math.atan2(dir.y, dir.x);
        this.manualAimHold = AIM.manualHold;
        this.lockedEnemy = null;
      }
    } else if (this.manualAimHold > 0) {
      // 손가락을 뗀 직후에 방향이 홱 돌아가지 않도록 잠깐 붙잡아 둔다.
      this.manualAimHold -= dt;
    }

    if (desired === null && this.manualAimHold <= 0) {
      const enemy = findNearestEnemy(this.player.pos, this.enemies, AIM.autoRange);
      this.lockedEnemy = enemy;
      if (enemy) {
        desired = Math.atan2(enemy.pos.y - this.player.pos.y, enemy.pos.x - this.player.pos.x);
      }
    }

    if (desired !== null) {
      this.player.facing = rotateToward(this.player.facing, desired, PLAYER.turnRate * dt);
    }
  }

  private updateFiring(dt: number): void {
    this.player.fireCooldown -= dt;
    if (this.player.fireCooldown > 0) return;
    this.player.fireCooldown += this.stats.fireCooldown;
    this.spawnArrow();
  }

  /**
   * 카드 한 장을 고른다. 능력치에 반영하고 카드를 내린다.
   * 고를 수 없는 id면 아무 일도 하지 않고 false — 화면이 어긋나도 게임이 멈춘 채로
   * 남지 않게 한다(멈춘 채로 남는 것이 이 기능의 가장 나쁜 고장이다).
   */
  chooseUpgrade(id: string): boolean {
    const chosen = this.offer?.choices.find((choice) => choice.card.id === id);
    if (!chosen) return false;

    this.stats = applyUpgrade(this.stats, chosen.card);
    this.upgradeStacks[id] = (this.upgradeStacks[id] ?? 0) + 1;
    this.takenUpgrades.push(id);

    this.offer = null;
    this.pendingLevelUps -= 1;
    // 한 번에 두 레벨이 올랐으면 곧바로 다음 카드를 띄운다. 다음 스텝을 기다리면
    // 게임이 한순간 움직였다가 다시 멈춰 화면이 튄다.
    if (this.pendingLevelUps > 0) this.openOffer();
    return true;
  }

  private openOffer(): void {
    const choices = rollUpgradeChoices(
      UPGRADE_CARDS,
      this.upgradeStacks,
      UPGRADE.choices,
      this.random,
    );
    if (choices.length === 0) {
      // 모든 카드를 최대까지 골랐다. 고를 것이 없으면 멈추지 않는다 —
      // 여기서 카드를 띄우면 아무도 내릴 수 없는 화면이 된다.
      this.pendingLevelUps = 0;
      return;
    }
    this.offer = { level: this.progress.level, remaining: this.pendingLevelUps, choices };
  }

  /**
   * 화살 하나를 장전한다. 쏘는 지점·방향·주인만 받는다.
   * 발사 규칙(쿨다운·조준)을 거치지 않는 유일한 입구다 —
   * 플레이어·적·8번 다중 발사·부하 측정 장면이 전부 여기로 들어온다.
   */
  addArrow(pos: Vec2, dir: Vec2, owner: ArrowOwner = 'player'): void {
    const d = normalize(dir);
    if (d.x === 0 && d.y === 0) return;
    const spec = owner === 'enemy' ? ENEMY.arrow : ARROW;
    this.arrows.push({
      id: this.nextArrowId++,
      owner,
      pos: { x: pos.x, y: pos.y },
      vel: { x: d.x * spec.speed, y: d.y * spec.speed },
      damage: spec.damage,
      lifetime: spec.lifetime,
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
