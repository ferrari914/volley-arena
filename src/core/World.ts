import {
  AIM,
  ARENA,
  ARROW,
  BOMBER,
  CHARGER,
  CORE,
  ENEMY,
  LEVEL,
  PLAYER,
  REINFORCE,
  REVIVE,
  SHIELD,
  UPGRADE,
  VIEW,
} from '../data/config';
import { DEFAULT_MAP, type ArenaMap } from '../data/maps';
import { UPGRADE_CARDS } from '../data/upgrades';
import {
  createEnemy,
  createPlayer,
  createXpCore,
  type Arrow,
  type ArrowOwner,
  type Blast,
  type Enemy,
  type EnemyKind,
  type EnemySpawn,
  type Player,
  type PlayerStats,
  type Progress,
  type UpgradeOffer,
  type XpCore,
} from '../entities/types';
import { length, normalize, rotateToward, wrapAngle, type Vec2 } from './math';
import { findNearestEnemy } from '../systems/autoAim';
import { damagePlayer, healPlayer, stepArrows, stepPlayerRecovery } from '../systems/combat';
import { stepEnemies, type EnemyBlast } from '../systems/enemyAi';
import {
  createDropCores,
  createProgress,
  gainXp,
  pickAmbientSpawn,
  stepCores,
} from '../systems/experience';
import { backstepBoost, movePlayer } from '../systems/movement';
import { insideObstacle } from '../systems/obstacles';
import { applyUpgrade, rollUpgradeChoices } from '../systems/upgrades';

export type { EnemySpawn };

export interface FrameInput {
  /** 이동 입력. 길이 0~1. y는 월드 Z축(화면 위가 -y). */
  move: Vec2;
  /** 수동 조준 방향. 손을 대지 않았으면 null → 자동 조준. */
  aim: Vec2 | null;
}

/**
 * 종류별 최대 체력과 방패 내구도. 적을 세우는 길이 `spawnEnemy` 하나뿐이라 표도 하나면 된다 —
 * 종류를 하나 더 넣을 때 고칠 자리가 여기와 `systems/enemyAi.ts` 둘로 끝나야 한다.
 */
function bodyOf(kind: EnemyKind): { maxHp: number; shieldHp: number } {
  if (kind === 'charger') return { maxHp: CHARGER.maxHp, shieldHp: 0 };
  if (kind === 'shield') return { maxHp: SHIELD.maxHp, shieldHp: SHIELD.shieldHp };
  if (kind === 'bomber') return { maxHp: BOMBER.maxHp, shieldHp: 0 };
  return { maxHp: ENEMY.maxHp, shieldHp: 0 };
}

export interface WorldOptions {
  /**
   * 어느 아레나에서 도는가 (DESIGN 10번). 생략하면 기본 맵(`빈 뜰`)이다 —
   * 지금까지 잰 밸런스 수치는 전부 그 맵의 것이므로 기본값을 옮기지 않는다.
   */
  map?: ArenaMap;
  /**
   * 적이 설 자리. 생략하면 맵이 정한 자리. 부하 측정 장면이 여기로 20마리를 세운다.
   * (맵을 함께 주면 기둥은 그 맵의 것을 쓰고 자리만 여기 것을 쓴다.)
   */
  enemies?: readonly EnemySpawn[];
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
  /**
   * 이 판이 도는 아레나 (DESIGN 10번). 판 중간에 바뀌지 않는다 —
   * 맵을 바꾸는 것은 판을 새로 만드는 것이고, 그 길은 `main.ts` 하나뿐이다.
   * 렌더러가 기둥을 세울 때(`Renderer.setMap`)도 이 값을 본다.
   */
  readonly map: ArenaMap;
  readonly player: Player = createPlayer(PLAYER.maxHp);
  readonly arrows: Arrow[] = [];
  readonly enemies: Enemy[];
  readonly cores: XpCore[] = [];
  /**
   * 터진 자국들 (DESIGN 9번 · 폭탄병). 화면이 잠깐 보여 주고 스스로 사라진다
   * (`BOMBER.flashTime`). 게임 상태를 바꾸지 않는 유일한 목록이다 —
   * 폭발이 하는 일은 터지는 그 프레임에 다 끝나고, 여기 남는 것은 자국뿐이다.
   */
  readonly blasts: Blast[] = [];

  /** 살아온 시간(s). */
  elapsed = 0;
  /** 적을 맞힌 횟수. 적에게 체력이 생긴 뒤로는 처치 수와 다르다. */
  hits = 0;
  /**
   * 그중 **코앞에서 닿아 더 깎은 횟수**(DESIGN 8번 · 코앞 카드). `hits`의 부분집합이다.
   * 화면에는 쓰지 않고 밸런스를 재는 쪽이 본다 — 둘의 비가 "얼마나 파고들었는가"다.
   */
  pointBlankHits = 0;
  /** 쓰러뜨린 적의 수. HUD의 "처치"이자 7번(결과 화면)이 그대로 쓸 값이다. */
  kills = 0;
  /**
   * 돌진형의 몸에 실제로 닿힌 횟수(무적에 막힌 것은 세지 않는다).
   * 화면에는 쓰지 않고 `xpByOrigin`처럼 밸런스를 재는 쪽이 본다 —
   * 한 대가 12점이라(화살 2.4발) 한 판 길이를 가장 크게 흔드는 것이 이 값이다.
   */
  bodyHits = 0;
  /**
   * 폭탄병이 터진 횟수와, 그중 실제로 몸에 닿힌 횟수(DESIGN 9번).
   * **한 쌍이라야 뜻이 있다** — 터진 수만 세면 "물러났는가"를 볼 수 없고,
   * 맞은 수만 세면 잘 쏴서 터지기 전에 눕힌 사람과 물러나서 피한 사람이 섞인다.
   * `bodyHits`와 같은 자리의 값이다(화면에는 쓰지 않고 밸런스를 재는 쪽만 본다).
   */
  blastsFired = 0;
  blastHits = 0;
  /**
   * 방패가 받아 낸 내 화살의 수(DESIGN 9번). `bodyHits`와 같은 자리에 있는 값이다 —
   * 화면에는 쓰지 않고 밸런스를 재는 쪽만 본다.
   *
   * **"돌았는가"는 이 값 하나가 아니라 `shieldBodyHits`와의 비가 말한다.** 방패병에게
   * 정면으로만 쏘면 여기가 쌓이고, 옆구리로 돌아 쏘면 같은 화살이 몸에 꽂혀 저쪽이 쌓인다.
   * 판 길이나 처치 수로는 그 차이를 볼 수 없다 — 어느 쪽이든 적은 결국 쓰러지고,
   * 다른 것은 걸린 시간뿐이다.
   */
  blockedShots = 0;
  /**
   * 방패병의 **몸에** 꽂힌 내 화살의 수(DESIGN 9번). `blockedShots`의 짝이다.
   *
   * **둘을 나눠야 "돌았는가"가 남는다**(`systems/combat.ts`의 주석). 막힌 수만 세면
   * 방패병 곁에 오래 서 있는 사람이 잘 도는 사람처럼 보이거나 그 반대가 된다 —
   * 그 값은 *얼마나 쐈는가*와 *얼마나 막혔는가*를 한꺼번에 담고 있다.
   */
  shieldBodyHits = 0;
  /**
   * 적이 쏜 화살의 수와, 그중 내 몸에 꽂힌 수. **피하기를 재는 한 쌍이다**(DESIGN 5번).
   *
   * 맞은 횟수만 세면 자란 사람과 안 자란 사람을 견줄 수 없다 — 잘 자란 사람은 적을 빨리
   * 눕혀 **날아오는 화살 자체가 적어서** 덜 맞는다. 그것은 피한 것이 아니다.
   * 쏜 수로 나눠야 "날아온 것 중 몇 발을 맞았는가"가 남는다.
   *
   * `bodyHits`·`blockedShots`와 같은 자리의 값이다 — 화면에는 쓰지 않고 밸런스를 재는 쪽만 본다.
   * 무적인 동안 그냥 지나간 화살은 `arrowHits`에 들어오지 않는다(맞은 것이 아니다).
   */
  enemyShots = 0;
  arrowHits = 0;
  /**
   * **기둥이 먹은 화살의 수**(DESIGN 10번). 주인별로 따로 센다 —
   * 내 쪽은 이 맵이 하는 일이고, 적 쪽은 고장의 신호다(`systems/combat.ts`의 주석).
   *
   * `eatenTheirs`는 `enemyShots`의 부분집합이다. 적은 맞힐 수 없는 곳에 쏘지 않으므로
   * 거기 남는 것은 **겨누는 0.5초 사이에 사람이 기둥 뒤로 몸을 숨긴 몫**뿐이고, 그것은 피한 것이다.
   */
  eatenMine = 0;
  eatenTheirs = 0;
  /** 지금 자동 조준이 잡고 있는 적. 없으면 null. */
  lockedEnemy: Enemy | null = null;

  /**
   * 플레이어가 쓰러졌는가. true가 되면 `step()`은 아무 일도 하지 않는다 —
   * 카드가 떠 있을 때와 같은 규칙이다(멈춤은 부르는 쪽이 아니라 World가 지킨다).
   * 여기서 나가는 길은 둘이다(DESIGN 6번): `revive()`로 이 자리에서 이어가거나,
   * World를 새로 만들어 처음부터 하거나. 되돌리는 쪽은 이 객체를 버린다.
   */
  defeated = false;

  /** 광고를 보고 다시 일어선 횟수. 쓰러진 화면과 결과 화면(7번)이 이 값을 적는다. */
  revives = 0;

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
    arrowCount: 1,
    pierce: 0,
    bounce: 0,
    knockback: 0,
    backstep: 0,
    pointBlank: 0,
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
  /** 지금까지 들어온 증원의 수. 다음 증원 시각과 상한을 여기 하나로 센다. */
  private joinedEnemies = 0;
  private nextCoreId = 1;
  private nextBlastId = 1;
  private ambientTimer = CORE.ambient.spawnInterval;
  private readonly random: () => number;

  constructor(options: WorldOptions = {}) {
    this.map = options.map ?? DEFAULT_MAP;
    this.enemies = (options.enemies ?? this.map.enemies).map((p) => {
      const enemy = this.spawnEnemy(p.kind ?? 'archer', p.x, p.y);
      // 처음 선 적은 잠깐 다가오기만 한다(`ENEMY.startDelay`). 손을 대기도 전에
      // 첫 대를 맞으면 무엇에 맞았는지 알 수 없다 — 일어선 사람에게 적이 기다려 주는 것
      // (`REVIVE.enemyDelay`)과 같은 자리다. **증원에는 주지 않는다**: 22m 밖에서
      // 걸어 들어오느라 이미 시간이 걸린다(`updateReinforcements`).
      enemy.fireCooldown = ENEMY.startDelay;
      return enemy;
    });
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
      // 뒷걸음 카드(DESIGN 8번)는 **겨눈 쪽에서 물러나는 동안에만** 듣는다.
      // 조준을 갱신하기 **전**의 `facing`으로 잰다 — 화면에 그려져 있던 그 방향이고,
      // 사람이 스틱을 기울일 때 보고 있던 것도 그것이다.
      this.stats.moveSpeed * backstepBoost(input.move, this.player.facing, this.stats.backstep),
      ARENA.radius,
      PLAYER.radius,
      this.map.obstacles,
    );

    this.updateAim(input, dt);
    this.updateFiring(dt);
    stepPlayerRecovery(this.player, dt);

    // 적이 먼저 쏘고 그 화살까지 이번 스텝에 함께 움직인다.
    // 순서를 뒤집으면 적이 쏜 화살이 한 프레임 동안 총구에 붙어 있다.
    this.updateReinforcements();

    const acted = this.updateEnemies(dt);
    for (const shot of acted.shots) this.addArrow(shot.pos, shot.dir, 'enemy');
    this.enemyShots += acted.shots.length;
    // 돌진형이 몸으로 닿힌 몫(DESIGN 9번). 화살과 같은 무적 규칙을 지나므로,
    // 몸통과 화살이 같은 순간에 닿아도 두 대를 한꺼번에 맞지는 않는다.
    for (const damage of acted.contacts) {
      if (damagePlayer(this.player, damage, PLAYER.invulnerable)) this.bodyHits += 1;
    }
    for (const blast of acted.blasts) this.detonate(blast);

    const result = stepArrows(this.arrows, {
      dt,
      arenaRadius: ARENA.radius,
      arrowRadius: ARROW.radius,
      enemyRadius: ENEMY.radius,
      playerRadius: PLAYER.radius,
      invulnerable: PLAYER.invulnerable,
      respawnDelay: ENEMY.respawnDelay,
      bounceRange: ARROW.bounceRange,
      pointBlankRange: ARROW.pointBlankRange,
      shieldArc: SHIELD.arc,
      obstacles: this.map.obstacles,
      player: this.player,
      enemies: this.enemies,
    });
    this.hits += result.hits;
    this.pointBlankHits += result.pointBlankHits;
    this.kills += result.killed.length;
    this.blockedShots += result.blocked;
    this.shieldBodyHits += result.shieldBodyHits;
    this.arrowHits += result.playerHits;
    this.eatenMine += result.eatenMine;
    this.eatenTheirs += result.eatenTheirs;
    for (const enemy of result.killed) {
      this.dropCores(enemy.pos);
      // 다시 설 자리는 **눕는 그 순간** 정한다(`pickRespawnSpot`). 3.6초 뒤 일어설 때가
      // 아니라 지금 정해 두어야, 그동안 `pickReinforceSpawn`이 "곧 저기에 선다"를 보고
      // 증원을 다른 쪽으로 부를 수 있다 — 그 함수는 쓰러진 적을 `standAt`으로 셈에 넣는다.
      enemy.standAt = this.pickRespawnSpot(enemy);
    }

    this.updateCores(dt);
    this.updateBlasts(dt);
    this.removeDeadArrows();

    // 체력이 다하면 여기서 판이 끝난다. 스텝의 나머지를 다 돌린 뒤에 판정하는 이유:
    // 마지막 한 발이 적을 쓰러뜨렸다면 그 처치도 기록에 남아야 한다.
    if (this.player.hp <= 0) this.defeated = true;

    // 레벨이 올랐으면 카드를 띄운다. 스텝의 마지막이어야 이번 스텝의 이동·명중이
    // 모두 반영된 뒤에 멈춘다(카드가 뜬 프레임에 화살이 허공에서 멈추지 않는다).
    if (!this.offer && this.pendingLevelUps > 0) this.openOffer();
  }

  /**
   * 시간이 지나면 적이 하나씩 더 들어온다(`REINFORCE`).
   *
   * **이것이 한 판의 길이를 붙잡아 두는 유일한 장치다.** 없으면 아레나가 판 내내
   * 그대로여서, 화력이 센 사람은 덜 맞고 끝없이 오래 산다(실측 514초).
   * 늘어난 적은 쓰러져도 들어온 자리에 다시 선다 — 배치에 처음부터 있던 적과 같다.
   *
   * 판이 끝난 뒤에는 부르지 않는다(`step()`이 이미 멈춰 있다). 부활로 이어 간 판에서는
   * 시계를 되돌리지 않으므로 증원도 이어진다 — 이어하기가 판을 쉽게 만들면 안 된다.
   */
  private updateReinforcements(): void {
    if (this.joinedEnemies >= REINFORCE.maxExtra) return;
    const due = REINFORCE.firstDelay + this.joinedEnemies * REINFORCE.interval;
    if (this.elapsed < due) return;

    this.joinedEnemies += 1;
    // 무엇이 들어오는지는 표가 정한다(`REINFORCE.order`). 순서가 코드가 아니라
    // 데이터에 있어야, 종류를 하나 더 넣을 때 이 함수를 고치지 않는다.
    const order = REINFORCE.order;
    const kind = order[(this.joinedEnemies - 1) % order.length] ?? 'archer';
    const at = this.pickReinforceSpawn();
    this.enemies.push(this.spawnEnemy(kind, at.x, at.y));
  }

  /** 적 한 마리를 세운다. 종류별 수치를 꺼내 오는 길은 여기 하나뿐이다. */
  private spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const { maxHp, shieldHp } = bodyOf(kind);
    return createEnemy(this.nextEnemyId++, x, y, maxHp, kind, shieldHp);
  }

  /**
   * 증원이 걸어 들어올 자리. 벽 가까이에서, 플레이어와 충분히 떨어진 곳을 고른다.
   *
   * **무작위 각도 하나를 뽑던 자리다. 그러면 뭉친다**(세션 26이 `shots/crowd-15.png`에서
   * 눈으로 봤다 — 대여섯이 한쪽에 서고 반대쪽 절반이 빈다). 프레임이 아니라
   * **읽히는가**의 문제다: 적이 한 덩어리로 서면 어느 쪽을 보고 있어야 하는지가
   * 화면 한쪽으로 정해져, 반대쪽 절반은 판 내내 볼 이유가 없는 땅이 된다.
   *
   * 그래서 두 가지를 바꿨다.
   *   1. 각도를 **등간격 후보**로 벌려 놓는다(무작위 시작각 + 360/12). 뽑을 때마다 독립인
   *      무작위는 우연히 몰리는 것을 막지 못한다. 시작각은 그대로 무작위라 판마다 다르다.
   *   2. 후보 중 **가장 빈 쪽**을 고른다 — 이미 선 적들에게서 각도가 가장 멀리 떨어진
   *      후보가 이긴다.
   *
   * **각도는 아레나 중심이 아니라 플레이어에서 본 방위각으로 잰다.** 화면은 플레이어를
   * 따라다니므로, 비어 보이는 쪽도 플레이어 기준이다. 쓰러져 있는 적은 **선 자리(`home`)로**
   * 셈에 넣는다 — 곧 그 자리에 다시 서므로(`enemyAi`의 `revive`) 지금 비었다고 그쪽으로
   * 부르면 잠시 뒤 둘이 겹친다.
   *
   * **중심에서 재는 쪽도 만들어 재 봤다. 더 고르게 서지만 게임이 순해진다**(세션 39).
   * 선 자리만 보고 중심 기준으로 벌리면 둘레가 거의 균등해지는데(자 37/43도),
   * 그러면 적이 플레이어를 에워싸는 대신 아레나에 고루 흩어져 잘 하는 사람이 덜 맞는다 —
   * 180판 p95가 331 → 359초로 벌어졌다(플레이어 기준은 347초). **뭉침을 푸는 것과
   * 에워싸는 것은 다르다.** 둘 중 화면이 원하는 것은 후자다.
   *
   * 플레이어에게 너무 가까운 후보는 버린다. 다 버려지는 일은 기하학적으로 없지만
   * (벽에 붙어 서도 코앞은 원 둘레의 5분의 1이다), 그래도 비면 가장 먼 후보를 쓴다 —
   * 자리 하나 때문에 프레임을 멈추지 않는다(맵 코어의 `pickAmbientSpawn`과 같은 규칙).
   *
   * 씨앗 20개 실측(열일곱 자리의 가장 넓은 빈 부채꼴 · 고르게 서면 21도):
   * 무작위 각도 **중앙 63도 · 최악 105도** → 여기 **중앙 47도 · 최악 56도**.
   * `tests/world.test.ts`의 '증원이 한쪽에 뭉치지 않는다'가 이 수치를 지킨다.
   *
   * **이 바퀴가 치른 값은 `REINFORCE.interval`·`maxExtra`에 적어 두었다** —
   * 뭉치지 않게 되자 위쪽 꼬리가 벌어져 증원을 28초 간격 · 열두 자리로 옮겼다.
   */
  private pickReinforceSpawn(): Vec2 {
    const base = this.random() * Math.PI * 2;
    const taken = this.enemyBearings();

    let best: Vec2 | null = null;
    let bestGap = -1;
    let farthest: Vec2 = { x: 0, y: 0 };
    let farthestDist = -1;

    for (let i = 0; i < REINFORCE.spawnCandidates; i += 1) {
      const angle = base + (i * Math.PI * 2) / REINFORCE.spawnCandidates;
      const candidate = {
        x: Math.cos(angle) * REINFORCE.spawnRadius,
        y: Math.sin(angle) * REINFORCE.spawnRadius,
      };
      const dx = candidate.x - this.player.pos.x;
      const dy = candidate.y - this.player.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > farthestDist) {
        farthestDist = dist;
        farthest = candidate;
      }
      if (dist < REINFORCE.minPlayerDistance) continue;
      // 기둥에 겹친 자리에는 세우지 않는다(DESIGN 10번). 지금 두 맵에서는 걸리지 않지만
      // (기둥 뜰의 바깥 끝이 20.2m, 증원은 22m 위에 선다) 새 맵이 기둥을 벽 가까이 두면
      // 여기가 막는다. 그 여백은 `tests/maps.test.ts`가 맵 데이터 쪽에서도 지킨다.
      if (insideObstacle(candidate, ENEMY.radius, this.map.obstacles)) continue;

      // 가장 가까운 적까지의 각도 거리. 적이 하나도 없으면 아무 후보나 좋다.
      let gap = Math.PI;
      const bearing = Math.atan2(dy, dx);
      for (const other of taken) gap = Math.min(gap, Math.abs(wrapAngle(bearing - other)));
      if (gap > bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    return best ?? farthest;
  }

  /**
   * 쓰러진 적이 다시 설 자리 (DESIGN 5번의 "가만히 서 있으면 쓰러진다").
   *
   * **여기가 아레나 가장자리를 요새로 만들던 자리다**(세션 49). 전에는 처음 선 자리
   * (`home`)로 그냥 돌아갔다. 그 자리들은 맵에 못 박혀 있으므로, **거기서 가장 먼 곳에
   * 서면 한 번 눕힐 때마다 적이 걸어 돌아오는 20~30m를 벌었다** — 손을 놓고도 112초를
   * 버티는 자리가 세 맵 모두에 있었다(한복판 42초). 그 자리의 활잡이는 제 사거리(15m)에
   * 닿아 보지도 못하고 평균 21.4m에서 눕는다. 벽이 가려 준 것이 아니라 **걷느라 싸우지
   * 못한 것**이다(사거리 밖에서 보낸 몫 — 한복판 0.09 · 요새 자리 0.32~0.47).
   *
   * 그래서 **플레이어를 둘러싼 고리 위**(`ENEMY.respawnDistance` 16m)에서 고른다.
   * 어디에 서 있든 다시 서는 적은 같은 거리에서 온다. 벽 앞이 안전해지는 길이 하나
   * 줄어드는 것이지, 벽을 등지는 것 자체가 막히는 것은 아니다 — 여전히 적은 반쪽에서만 온다.
   *
   * **자리를 고르는 규칙은 증원과 같다**(위 `pickReinforceSpawn`): 등간격 후보 열둘 ·
   * 무작위 시작각 · 이미 선 적들에게서 방위각이 가장 먼 후보. 여기서 따로 만들면
   * "적이 어디서 오는가"가 두 규칙이 되고, 한쪽만 고치는 바퀴가 반드시 나온다.
   * 다른 것은 고리의 중심(플레이어)과 반지름뿐이다.
   *
   * **한 번 눕는 데 두 번 고른다 — 눕는 순간의 예약과 일어서기 직전의 확정이다.**
   * 확정이 필요한 이유는 `placeRisingEnemies`에 적었다(움직이는 사람에게서 자리가 뒤처진다).
   * 예약을 그래도 남겨 두는 이유는 그 3.6초 동안 `enemyBearings`가 "곧 저기에 선다"를
   * 읽어야 하기 때문이다 — 안 그러면 그사이 걸어 들어온 증원이 같은 쪽에 겹쳐 선다.
   *
   * 벽 밖이나 기둥 속으로는 세우지 않는다. 고리가 16m라 벽 앞에 바짝 붙어 서도 아레나
   * 안쪽 후보가 반드시 남지만(가장 안쪽 후보가 중심에서 10.8m), 새 맵이 기둥을 넓게 두면
   * 전부 버려질 수 있다 — 그때는 **아레나 중심에 가장 가까운 후보**를 쓴다.
   * 자리 하나 때문에 프레임을 멈추지 않는 것은 `pickReinforceSpawn`과 같은 규칙이다.
   */
  private pickRespawnSpot(fallen: Enemy): Vec2 {
    const base = this.random() * Math.PI * 2;
    // 눕는 본인은 셈에서 뺀다. 지금 그 자리에 누워 있다고 해서 다시 설 자리를
    // 그 반대쪽으로 밀 이유가 없다 — 그러면 눕힐 때마다 아레나를 가로질러 오간다.
    const taken = this.enemyBearings(fallen);
    const limit = ARENA.radius - ENEMY.radius;

    let best: Vec2 | null = null;
    let bestGap = -1;
    let inmost: Vec2 = { x: this.player.pos.x, y: this.player.pos.y };
    let inmostDist = Infinity;

    for (let i = 0; i < REINFORCE.spawnCandidates; i += 1) {
      const bearing = base + (i * Math.PI * 2) / REINFORCE.spawnCandidates;
      const candidate = {
        x: this.player.pos.x + Math.cos(bearing) * ENEMY.respawnDistance,
        y: this.player.pos.y + Math.sin(bearing) * ENEMY.respawnDistance,
      };
      const fromCenter = length(candidate);
      if (fromCenter < inmostDist) {
        inmostDist = fromCenter;
        inmost = candidate;
      }
      if (fromCenter > limit) continue;
      if (insideObstacle(candidate, ENEMY.radius, this.map.obstacles)) continue;

      let gap = Math.PI;
      for (const other of taken) gap = Math.min(gap, Math.abs(wrapAngle(bearing - other)));
      if (gap > bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    if (best) return best;
    // 후보가 전부 버려졌다. 가장 안쪽 후보를 벽 안으로 당겨 쓴다.
    const scale = inmostDist > limit ? limit / inmostDist : 1;
    return { x: inmost.x * scale, y: inmost.y * scale };
  }

  /**
   * 지금 서 있는 적들을 **플레이어에서 본 방위각**으로. 자리를 고르는 둘이 함께 쓴다.
   *
   * 화면은 플레이어를 따라다니므로 비어 보이는 쪽도 플레이어 기준이다(위 `pickReinforceSpawn`).
   * 쓰러져 있는 적은 **다시 설 자리(`standAt`)로** 셈에 넣는다 — 곧 그 자리에 서므로
   * (`enemyAi`의 `revive`) 지금 비었다고 그쪽으로 부르면 잠시 뒤 둘이 겹친다.
   */
  private enemyBearings(exclude?: Enemy): number[] {
    const bearings: number[] = [];
    for (const e of this.enemies) {
      if (e === exclude) continue;
      const at = e.alive ? e.pos : e.standAt;
      bearings.push(Math.atan2(at.y - this.player.pos.y, at.x - this.player.pos.x));
    }
    return bearings;
  }

  /**
   * 죽은 그 자리에서 이어서 진행한다 — DESIGN 6번의 "부활(광고)".
   *
   * **되돌리는 것은 몸 상태뿐이다.** 레벨·능력치·고른 카드는 전부 이 객체 안에 그대로
   * 있으므로 손대지 않는다. 그것이 리스폰(전부 초기화)과 부활을 가르는 유일한 차이이고,
   * 광고를 볼 이유이기도 하다.
   *
   * 쓰러지지 않았는데 부르면 아무 일도 하지 않고 false를 돌려준다 —
   * 화면이 어긋나 두 번 눌려도 무적 시간이 공짜로 갱신되지 않게 한다.
   */
  revive(): boolean {
    if (!this.defeated) return false;
    this.defeated = false;
    this.revives += 1;

    this.player.hp = this.player.maxHp;
    this.player.hitFlash = 0;
    this.player.invulnerable = REVIVE.invulnerable;

    // 일어서는 순간 이미 날아오고 있던 적의 화살은 지운다. 무적이라 맞지는 않지만,
    // 화살이 몸을 그대로 통과하는 그림은 "왜 안 맞지"로 읽힌다.
    for (const arrow of this.arrows) {
      if (arrow.owner === 'enemy') arrow.alive = false;
    }
    this.removeDeadArrows();

    // 겨누고 있던 적은 겨눔을 풀고 잠깐 기다린다. 그러지 않으면 일어선 그 프레임에
    // 발밑에서 화살이 나가고, 무적이 끝나는 즉시 같은 자리에서 또 쓰러진다.
    for (const enemy of this.enemies) {
      enemy.aimTimer = 0;
      // 몸을 던지고 있던 돌진형도 멈춘다. 일어서는 그 프레임에 몸통이 닿아 있으면
      // 무적이 끝나기도 전에 다시 쓰러질 자리가 만들어진다(DESIGN 6번의 그 이유).
      enemy.dashTimer = 0;
      enemy.fireCooldown = Math.max(enemy.fireCooldown, REVIVE.enemyDelay);
    }
    return true;
  }

  /**
   * **일어서기 직전에 설 자리를 다시 고른다.** 눕는 순간에 잡아 둔 자리(`standAt`)는
   * 3.6초 동안 굳어 있는데, 플레이어는 그동안 최대 25m를 간다(속도 7.2m/s).
   * 그대로 쓰면 "플레이어에게서 16m"라는 규칙이 **움직이는 사람에게만 거짓**이 된다 —
   * 뛰어다니는 사람 뒤로 적이 계속 뒤처져 서고, 판이 길어진다.
   * 실측(예순 판 p90 · `tests/progression.test.ts`): 눕는 순간에만 고르면 **344초**,
   * 여기서 다시 고르면 **304초**다(고치기 전 310초).
   *
   * 눕는 순간의 예약을 버리지 않는 이유는 `pickRespawnSpot`에 적어 두었다.
   */
  private placeRisingEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      // `stepEnemies`가 이번 스텝에 타이머를 0 밑으로 내리고 세울 적들이다.
      if (!enemy.alive && enemy.respawnTimer <= dt) enemy.standAt = this.pickRespawnSpot(enemy);
    }
  }

  /** 적을 한 스텝 움직인다. 돌려받은 것은 이번에 적이 쏜 화살들이다. */
  private updateEnemies(dt: number) {
    this.placeRisingEnemies(dt);
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
      contactRadius: ENEMY.radius + PLAYER.radius,
      charger: CHARGER,
      shield: SHIELD,
      bomber: BOMBER,
      obstacles: this.map.obstacles,
      // 적이 겨누기를 시작해도 되는 창(`data/config.ts`의 `VIEW`). 게임이 화면을 아는
      // 유일한 자리다 — 화면 밖에서 시작된 예고는 아무도 볼 수 없다.
      view: VIEW,
      // 화살이 막히는 판정(`updateCombat`)과 같은 굵기다. 시야를 그보다 후하게 재면
      // 적이 "보인다"고 믿고 쏜 화살이 기둥에 박힌다.
      arrowRadius: ARROW.radius,
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
      obstacles: this.map.obstacles,
    });
    // 맵에 놓인 코어는 스스로 사라지지 않는다. 걸어가는 사이에 없어지면 주우러 갈 이유가 없다.
    this.cores.push(createXpCore(this.nextCoreId++, pos, CORE.ambient.value, 'ambient', Infinity));
  }

  /**
   * 폭탄병 하나가 터졌다 (DESIGN 9번). 여기서 하는 일은 셋이다 —
   * **원 안을 맞히고 · 자국을 남기고 · 다시 설 자리를 잡아 둔다.**
   *
   * **맞히는 원과 그리는 원이 같다**(`blast.radius`). 화면의 고리 밖으로 나간 사람은
   * 반드시 안 맞아야 한다 — 그 약속이 어긋나면 이 적이 요구하는 것(물러나라)을
   * 화면에서 배울 수 없다. 재는 것은 **몸의 중심**이다(고리는 바닥에 그려진다).
   *
   * **화살과 같은 무적 규칙을 지난다**(`PLAYER.invulnerable`) — 터지는 순간 화살까지
   * 함께 꽂혀 한 프레임에 두 대를 맞는 일이 없어야 한다.
   *
   * **처치로 세지 않고 코어도 떨구지 않는다.** 그 둘은 `result.killed`가 하는 일이고
   * (`step`), 스스로 터진 폭탄병은 거기 들어가지 않는다 — 가만히 서서 맞아 주는 것이
   * 경험치를 버는 길이 되면 안 된다.
   */
  private detonate(blast: EnemyBlast): void {
    this.blastsFired += 1;
    this.blasts.push({
      id: this.nextBlastId++,
      pos: { x: blast.at.x, y: blast.at.y },
      radius: blast.radius,
      age: 0,
      alive: true,
    });
    // 다시 설 자리는 화살에 쓰러진 적과 같은 규칙으로 **눕는 그 순간** 잡아 둔다
    // (`pickRespawnSpot`). 그래야 그동안 증원이 "곧 저기에 선다"를 보고 다른 쪽으로 온다.
    blast.from.standAt = this.pickRespawnSpot(blast.from);

    // 쓰러진 사람은 더 맞지 않는다(적이 쏘지 않는 것과 같은 규칙).
    if (this.player.hp <= 0) return;
    const dx = this.player.pos.x - blast.at.x;
    const dy = this.player.pos.y - blast.at.y;
    if (dx * dx + dy * dy > blast.radius * blast.radius) return;
    if (damagePlayer(this.player, blast.damage, PLAYER.invulnerable)) this.blastHits += 1;
  }

  /** 터진 자국은 시간만 흐르다 사라진다. 게임 규칙에 닿는 것이 없다. */
  private updateBlasts(dt: number): void {
    if (this.blasts.length === 0) return;
    for (const blast of this.blasts) {
      blast.age += dt;
      if (blast.age >= BOMBER.flashTime) blast.alive = false;
    }
    for (let i = this.blasts.length - 1; i >= 0; i -= 1) {
      if (!this.blasts[i]?.alive) this.blasts.splice(i, 1);
    }
  }

  private dropCores(at: Vec2): void {
    const dropped = createDropCores(at, () => this.nextCoreId++, this.random, {
      count: CORE.drop.perKill,
      value: CORE.drop.value,
      lifetime: CORE.drop.lifetime,
      scatter: CORE.drop.scatter,
      limitRadius: ARENA.radius - 0.6,
      obstacles: this.map.obstacles,
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
    // 회복 카드는 능력치가 아니라 몸에 닿는다(DESIGN 8번). 최대 체력에 대한 비율이라
    // 나중에 최대 체력이 달라져도 카드 쪽을 고치지 않아도 된다.
    if (chosen.card.heal) healPlayer(this.player, this.player.maxHp * chosen.card.heal);
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
      // 가득 찬 체력으로는 회복 카드를 보지 않는다 — 고를 수 없는 카드는 선택이 아니다.
      this.player.hp < this.player.maxHp,
      // 석 장이 모두 보조면 이번 레벨업에 화력을 고를 길이 없다. 왜 이 값인지는 config에.
      UPGRADE.maxSupport,
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
      // 관통도 튕김도 플레이어의 카드다. 적의 화살이 노리는 것은 한 사람뿐이라
      // 뚫고 갈 다음 상대도, 꺾어 갈 다음 상대도 없다.
      pierce: owner === 'player' ? Math.max(0, Math.round(this.stats.pierce)) : 0,
      bounce: owner === 'player' ? Math.max(0, Math.round(this.stats.bounce)) : 0,
      // 밀어내기도 플레이어의 카드다. 적의 화살이 사람을 밀면 터질 원 밖으로 밀려나는
      // 일이 생겨, 맞는 것이 오히려 사는 길이 되는 프레임이 생긴다.
      knockback: owner === 'player' ? Math.max(0, this.stats.knockback) : 0,
      // 코앞도 플레이어의 카드다. 적의 화살까지 거리를 보면 붙어 선 것이 두 배로
      // 아픈 일이 되어, 이 카드가 요구하는 "파고들어라"를 게임이 도로 막는다.
      pointBlank: owner === 'player' ? Math.max(0, this.stats.pointBlank) : 0,
      alive: true,
    });
  }

  /**
   * 한 번의 발사. 화살 수가 늘면(다중 발사, DESIGN 8번) 조준 방향을 가운데 두고
   * 좌우로 고르게 벌린 부채꼴로 나간다.
   *
   * 개수는 홀수만 나온다(1 → 3 → 5). 그래서 가운데 한 발은 늘 조준한 방향 그대로다 —
   * 짝수로 늘리면 정면이 비어 "겨눈 곳에 안 나간다"로 보인다.
   * 각 화살은 **자기 방향으로** 총구 거리만큼 나가서 생긴다. 한 점에서 뿌리면
   * 바로 앞의 적에게는 부채꼴이 채 벌어지기도 전에 전부 꽂혀 거리감이 사라진다.
   */
  private spawnArrow(): void {
    const count = Math.max(1, Math.round(this.stats.arrowCount));
    const base = this.player.facing - ((count - 1) / 2) * ARROW.spread;
    for (let i = 0; i < count; i += 1) {
      const angle = base + i * ARROW.spread;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      this.addArrow(
        {
          x: this.player.pos.x + dir.x * ARROW.muzzleOffset,
          y: this.player.pos.y + dir.y * ARROW.muzzleOffset,
        },
        dir,
      );
    }
  }

  private removeDeadArrows(): void {
    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      if (!this.arrows[i]?.alive) this.arrows.splice(i, 1);
    }
  }
}
