import { length, rotateToward, type Vec2 } from '../core/math';
import type { Enemy, Obstacle, XpCore } from '../entities/types';
import { settleBody } from './movement';
import { insideObstacle, sightBlocker } from './obstacles';

/**
 * 적 봇의 행동 (DESIGN 5번 · 9번).
 *
 * 규칙은 셋뿐이다 — **다가온다 · 예고한다 · 저지른다.**
 * 상태를 따로 두지 않고 타이머로만 굴린다(`aimTimer`·`fireCooldown`, 돌진형은 `dashTimer`).
 *
 * 종류가 넷으로 늘었지만(DESIGN 9번) 이 문법은 그대로다. 갈리는 것은 마지막 한 칸,
 * **무엇을 저지르는가**뿐이다:
 *   활잡이(archer)   — 멈춰 서서 겨눈 뒤 → 화살을 놓는다
 *   돌진형(charger)  — 멈춰 서서 웅크린 뒤 → 몸을 던진다
 *   방패병(shield)   — 멈춰 서서 겨눈 뒤 → 화살을 놓는다 (활잡이와 같다)
 *   폭탄병(bomber)   — 멈춰 서서 달아오른 뒤 → 제 몸을 터뜨린다
 *   약탈꾼(looter)   — 멈춰 서서 웅크린 뒤 → **코어를 삼킨다** (플레이어를 때리지 않는다)
 * 예고 칸을 종류마다 다시 만들지 않은 이유: 예고 없이 아픈 적은 피할 방법이 없고,
 * 예고의 모양이 종류마다 다르면 처음 하는 사람이 매번 새로 배워야 한다.
 *
 * **방패병이 새로 요구하는 것은 저지르는 쪽이 아니라 막는 쪽이다** — 정면으로 온
 * 화살을 방패가 받아 낸다. 그 판정은 여기가 아니라 화살 쪽에 있다
 * (`systems/combat.ts`의 `blocksArrow`). 여기서 방패병이 활잡이와 다른 것은 셋뿐이다:
 * 느리게 걷고, **느리게 돌고**(옆구리가 열리는 이유다), 옆으로 돌지 않고 버티고 선다.
 *
 * 활잡이는 거리를 세 구간으로 나눈다:
 *   멀다(> approach)        → 다가온다
 *   가깝다(< keep)          → 물러난다
 *   사이                    → 옆으로 돈다
 * 두 경계 사이를 벌려 두지 않으면 적이 한 발짝마다 앞뒤로 떨린다.
 *
 * **거리보다 먼저 보는 것이 하나 있다: 보이는가**(DESIGN 10번의 기둥이 생기고부터).
 * 기둥에 가려 화살이 닿지 못하면 겨누지 않고 **옆으로 돌아 시야를 되찾는다**
 * (`clearSightMove`). 이것이 없으면 기둥 뒤에 선 사람에게 적이 화살을 기둥에
 * 먹이며 제자리에 서 있어, 손을 놓고도 세 배를 버티는 자리가 맵마다 생긴다.
 *
 * **그 물음은 두 번 묻는다 — 나에게 보이는가, 그리고 화면에 보이는가**(세션 50).
 * 화면 밖에 선 적도 겨누기를 시작하지 않는다(`outOfView`). `fireRange`(15)가
 * 화면이 뒤로 보여 주는 거리(12.4m)보다 길어서, 뒤쪽 15m에 선 적은 **화면 밖에서
 * 멈춰 겨누고 쏘았다.** 기둥에 가린 것과 같은 종류의 일이다 — 예고를 볼 수 없으면
 * 피할 방법이 없다. 다른 것은 그다음 걸음뿐이다: 가려 있으면 시야를 되찾으러 돌고,
 * 화면 밖이면 그냥 다가온다(화면 밖은 언제나 `approachDistance` 밖이다).
 * **약탈꾼만 다가가는 곳이 플레이어가 아니다**(`stepLooter`). 그래서 이 파일에서 그 적만
 * `playerPos`를 **가지 않을 자리**로 쓴다 — 플레이어 곁의 코어는 건드리지 않고
 * (`LOOTER.guard`), 훔칠 것이 없으면 물러나 선다(`LOOTER.standOff`).
 * 다섯 중 유일하게 **플레이어를 향해 돌지 않는 적**이기도 하다.
 *
 * **돌진형과 폭탄병에는 이 구간이 없다.** 물러나지도 옆으로 돌지도 않고 곧장 온다 —
 * 그것이 활잡이와 정반대인 지점이고, 둘이 함께 있어야 하는 이유다.
 * 그 둘은 가림도 화면도 묻지 않는다(저지르는 자리가 코앞이라 언제나 보인다).
 */
/**
 * 화면이 플레이어 앞뒤로 보여 주는 거리(m). 값은 `data/config.ts`의 `VIEW`에서 온다.
 * 좌우가 없는 이유도 거기 적어 두었다 — 겨누는 거리 안에서는 한 번도 걸리지 않는다.
 */
export interface ViewWindow {
  forward: number;
  back: number;
}

export interface EnemyStepOptions {
  dt: number;
  playerPos: Vec2;
  /** 플레이어가 살아 있는가. 쓰러진 사람을 계속 쏘면 결과 화면 뒤가 시끄럽다. */
  playerAlive: boolean;
  arenaRadius: number;
  /** 적의 몸 반지름(m). 벽에 몸이 반쯤 묻히지 않게 자를 때 쓴다. */
  bodyRadius: number;
  speed: number;
  turnRate: number;
  respawnDelay: number;
  fireRange: number;
  approachDistance: number;
  keepDistance: number;
  strafeRatio: number;
  separation: number;
  aimTime: number;
  fireCooldown: number;
  spread: number;
  muzzleOffset: number;
  /** 돌진형이 몸으로 닿았는지 재는 거리(m). 적 반지름 + 플레이어 반지름. */
  contactRadius: number;
  /** 돌진형(DESIGN 9번)의 수치. 활잡이와 겹치지 않는 값만 여기 둔다. */
  charger: ChargerOptions;
  /** 방패병(DESIGN 9번)의 수치. 활잡이와 같은 이름의 값이라도 값이 달라 여기 따로 둔다. */
  shield: ShieldOptions;
  /** 폭탄병(DESIGN 9번)의 수치. 이 적만 쓰는 값이라 전부 여기 있다. */
  bomber: BomberOptions;
  /** 약탈꾼(DESIGN 9번)의 수치. 이 적만 쓰는 값이라 전부 여기 있다. */
  looter: LooterOptions;
  /**
   * 지금 맵에 놓인 경험치 코어들(DESIGN 3번). **약탈꾼 하나 때문에 여기 있다** —
   * 다섯 중 그 적만 플레이어가 아닌 것을 보고 걷는다(`stepLooter`).
   * **이 함수는 코어를 지우지 않는다.** 삼킨 것은 `result.steals`로 돌려주고,
   * 실제로 없애는 것은 받는 쪽(World)의 일이다 — 폭탄병의 원이 누구에게 닿았는지를
   * 여기서 정하지 않는 것과 같은 규칙이다.
   */
  cores: readonly XpCore[];
  /** 이 맵에 선 기둥들(DESIGN 10번). 적의 몸도 플레이어와 같은 규칙으로 막힌다. */
  obstacles: readonly Obstacle[];
  /**
   * 화면이 플레이어 앞뒤로 보여 주는 거리(m · `data/config.ts`의 `VIEW`).
   * **적이 겨누기를 시작해도 되는지만 가른다** — 어떻게 움직이는지는 이 값을 보지 않는다.
   */
  view: ViewWindow;
  /**
   * 화살의 굵기(m). **시야를 재는 데 쓴다** — 적이 "보인다"고 판단하는 선과 화살이
   * 실제로 기둥에 막히는 선(`combat.ts`)이 같아야, 쏜 화살이 기둥에 박히는 일이 없다.
   */
  arrowRadius: number;
  /** 조준을 흔드는 데 쓴다. World의 씨앗 고정 난수가 들어온다. */
  random: () => number;
}

/** 돌진형만 쓰는 수치. 시작값은 `data/config.ts`의 `CHARGER`에서 온다. */
export interface ChargerOptions {
  speed: number;
  turnRate: number;
  triggerRange: number;
  windup: number;
  dashSpeed: number;
  dashTime: number;
  dashCooldown: number;
  backoff: number;
  damage: number;
}

/**
 * 방패병만 쓰는 수치. 시작값은 `data/config.ts`의 `SHIELD`에서 온다.
 * 앞의 셋(`aimTime`·`fireCooldown`·`fireRange`)은 활잡이와 이름이 같다 —
 * 같은 `updateFiring`에 그대로 건네주기 위해서다(`FiringTiming`).
 */
export interface ShieldOptions {
  aimTime: number;
  fireCooldown: number;
  fireRange: number;
  speed: number;
  turnRate: number;
  approachDistance: number;
  keepDistance: number;
  /** 방패가 다시 설 때 돌아오는 내구도. 판정은 `combat.ts`가 하고, 되돌리는 것만 여기서 한다. */
  shieldHp: number;
}

/**
 * 폭탄병만 쓰는 수치. 시작값은 `data/config.ts`의 `BOMBER`에서 온다.
 * **`blastRadius`와 `damage`는 이 파일에서 쓰이지 않고 그대로 나간다**(`EnemyBlast`) —
 * 터진 원이 누구에게 닿았는지는 받는 쪽(World)이 판단한다. 쏜 화살의 피해를
 * 여기서 정하지 않는 것과 같은 이유다.
 */
export interface BomberOptions {
  speed: number;
  turnRate: number;
  triggerRange: number;
  fuse: number;
  blastRadius: number;
  damage: number;
}

/**
 * 약탈꾼만 쓰는 수치. 시작값은 `data/config.ts`의 `LOOTER`에서 온다.
 * **`reach`만 거기 없다** — 몸 반지름과 코어 반지름을 더한 값이라 World가 채운다
 * (돌진형의 `contactRadius`와 같은 자리다).
 */
export interface LooterOptions {
  speed: number;
  turnRate: number;
  /** 플레이어에게서 이 거리 안의 코어는 건드리지 않는다(m). */
  guard: number;
  /** 훔칠 코어가 없을 때 물러나 서는 거리(m). */
  standOff: number;
  /** 코어 위에 멈춰 서서 삼키는 시간(s). */
  swallow: number;
  /** 코어에 닿았다고 보는 거리(m). 적 반지름 + 코어 반지름. */
  reach: number;
}

/**
 * 겨누고 쏘는 박자. 활잡이와 방패병이 같은 코드를 쓰되 값만 갈린다 —
 * 종류마다 겨눔을 새로 만들면 "멈춰 선 적은 곧 무언가 한다"는 예고의 규칙이 갈라진다.
 */
interface FiringTiming {
  aimTime: number;
  fireCooldown: number;
  fireRange: number;
}

/** 이번 스텝에 적이 쏜 화살 하나. World가 이것을 받아 실제 화살로 만든다. */
export interface EnemyShot {
  pos: Vec2;
  dir: Vec2;
}

/**
 * 이번 스텝에 터진 폭탄병 하나 (DESIGN 9번). **누구에게 닿았는지는 여기서 정하지 않는다** —
 * 원과 그 안에 무엇이 있었는지를 가르는 것은 받는 쪽(World)의 일이고, 여기서 하면
 * 무적 시간(`PLAYER.invulnerable`)을 이 파일이 알아야 한다.
 */
export interface EnemyBlast {
  /** 터진 자리. **몸이 서 있던 그 자리다** — 화면의 고리도 같은 중심이다. */
  at: Vec2;
  radius: number;
  damage: number;
  /** 터진 그 폭탄병. 다시 설 자리를 잡아 두려고 World가 본다. */
  from: Enemy;
}

/**
 * 이번 스텝에 적이 한 일. 화살도 몸통 박치기도 폭발도 여기서 만들지 않고 돌려주기만 한다 —
 * 화살의 id·속도·수명과 플레이어의 무적 규칙은 World와 `combat.ts`가 쥐고 있고,
 * 그래야 이 함수가 그것들을 몰라도 되어 테스트에서 적만 따로 돌려볼 수 있다.
 */
export interface EnemyStepResult {
  shots: EnemyShot[];
  /** 돌진형이 몸으로 닿힌 피해량들. 무적 판정은 받는 쪽이 한다. */
  contacts: number[];
  /** 이번 스텝에 터진 폭탄병들. 비어 있는 경우가 대부분이다. */
  blasts: EnemyBlast[];
  /** 이번 스텝에 약탈꾼이 삼킨 코어들. 없애는 것은 받는 쪽(World)의 일이다. */
  steals: CoreSteal[];
}

/** 약탈꾼 하나가 코어 하나를 삼켰다 (DESIGN 9번). */
export interface CoreSteal {
  core: XpCore;
  /** 삼킨 그 약탈꾼. 세는 쪽이 누구인지 알아야 할 때를 위해 함께 돌려준다. */
  by: Enemy;
}

/** 적을 한 스텝 움직이고, 이번에 저지른 것들을 돌려준다. */
export function stepEnemies(enemies: Enemy[], options: EnemyStepOptions): EnemyStepResult {
  const { dt, playerPos } = options;
  const result: EnemyStepResult = { shots: [], contacts: [], blasts: [], steals: [] };

  for (const enemy of enemies) {
    if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 2.5);
    // 방패의 번쩍임은 **몸의 피격 번쩍임보다 빨리 꺼진다**(3.2 → 6.0 = 0.17초).
    // 몸은 한 대 맞고 한동안 조용하지만, 방패는 정면으로 쏘는 내내 매 발 다시 켜진다
    // (플레이어의 발사 간격은 0.38초, 연사를 다 쌓으면 0.16초다). 천천히 꺼지면
    // 켜진 채로 이어져 **번쩍임이 사건이 아니라 방패의 평소 색**이 되고,
    // 그러면 판이 닳아 흐려지는 것(`Renderer.syncShield`)이 그 흰빛에 덮여 보이지 않는다.
    if (enemy.shieldFlash > 0) enemy.shieldFlash = Math.max(0, enemy.shieldFlash - dt * 6);

    if (!enemy.alive) {
      enemy.respawnTimer -= dt;
      if (enemy.respawnTimer <= 0) revive(enemy, options);
      continue;
    }

    const toPlayer = { x: playerPos.x - enemy.pos.x, y: playerPos.y - enemy.pos.y };
    const dist = length(toPlayer);
    const dir = dist > 1e-6 ? { x: toPlayer.x / dist, y: toPlayer.y / dist } : { x: 1, y: 0 };

    if (enemy.kind === 'charger') {
      stepCharger(enemy, enemies, dir, dist, options, result);
      continue;
    }

    if (enemy.kind === 'shield') {
      const shot = stepShield(enemy, enemies, dir, dist, options);
      if (shot) result.shots.push(shot);
      continue;
    }

    if (enemy.kind === 'bomber') {
      stepBomber(enemy, enemies, dir, dist, options, result);
      continue;
    }

    if (enemy.kind === 'looter') {
      stepLooter(enemy, enemies, dir, dist, options, result);
      continue;
    }

    // 몸은 늘 플레이어를 향해 돈다. 화살은 몸이 보는 쪽으로 나가므로,
    // 방금 등 뒤로 돌아간 플레이어를 곧바로 맞히지 못한다 — 그 틈이 회피의 여지다.
    enemy.facing = rotateToward(
      enemy.facing,
      Math.atan2(dir.y, dir.x),
      options.turnRate * dt,
    );

    // 지금 기둥에 가려 있는가. 겨눌지 말지와 어디로 움직일지를 둘 다 이것이 가른다.
    const blocker = sightBlocker(enemy.pos, playerPos, sightWidth(dist, options), options.obstacles);

    // 가려 있는 것과 화면 밖에 있는 것은 **같은 종류의 일이다** — 둘 다 예고를 볼 수 없다.
    // 그래서 겨누기를 시작하는 쪽에서는 하나로 묶고, 움직이는 쪽에서는 가른다
    // (가려 있으면 시야를 되찾으러 옆으로 돌고, 화면 밖이면 그냥 다가온다 — 아래 `outOfView`).
    const shot = updateFiring(
      enemy,
      dist,
      options,
      options,
      blocker !== null || outOfView(enemy, playerPos, options.view),
    );
    if (shot) result.shots.push(shot);

    // 겨누는 동안에는 멈춰 선다. 이것이 "지금 나를 노리고 있다"는 유일한 예고다.
    const move =
      enemy.aimTimer > 0 ? { x: 0, y: 0 } : desiredMove(enemy, dir, dist, options, blocker);
    addSeparation(move, enemy, enemies, options.separation);
    moveBy(enemy, move, options.speed, options);
  }

  return result;
}

/**
 * 돌진형 한 마리 (DESIGN 9번). 활잡이와 같은 문법을 쓰되 마지막 칸이 다르다 —
 * **다가온다 → 웅크린다 → 몸을 던진다 → 숨을 고른다.**
 *
 * 돌진 중에는 세 가지를 하지 않는다. 셋 다 "피할 수 있는 적"을 위해서다:
 * - **돌지 않는다.** 방향은 웅크림이 끝나는 순간 정해지고, 그 뒤로는 직선이다.
 *   따라 꺾으면 옆으로 비켜도 소용이 없어져 피할 방법이 사라진다.
 * - **밀어내기를 받지 않는다.** 다른 적에게 밀려 궤도가 휘면 직선이라는 약속이 깨진다.
 * - **다시 겨누지 않는다.** 한 번 저지른 뒤에는 반드시 숨 고르는 틈이 있다.
 */
function stepCharger(
  enemy: Enemy,
  enemies: readonly Enemy[],
  dir: Vec2,
  dist: number,
  options: EnemyStepOptions,
  result: EnemyStepResult,
): void {
  const { dt, charger } = options;

  if (enemy.dashTimer > 0) {
    enemy.dashTimer = Math.max(0, enemy.dashTimer - dt);
    const ahead = { x: Math.cos(enemy.facing), y: Math.sin(enemy.facing) };
    moveBy(enemy, ahead, charger.dashSpeed, options);

    // 몸이 닿았으면 거기서 돌진이 끝난다. 플레이어를 뚫고 지나가면 한 번의 돌진이
    // 무적이 풀리는 순간 두 번째 피해를 주게 되어, 예고 한 번에 두 대를 맞는다.
    if (options.playerAlive && distanceTo(enemy, options.playerPos) <= options.contactRadius) {
      result.contacts.push(charger.damage);
      enemy.dashTimer = 0;
    }
    if (enemy.dashTimer <= 0) enemy.fireCooldown = charger.dashCooldown;
    return;
  }

  // 웅크리는 동안에도 몸은 돈다 — 돌진 방향이 정해지는 것은 튀어나가는 그 순간이다.
  // 그래서 예고를 보고 곧바로 옆으로 뛰면 빗나가고, 굳어 있으면 맞는다.
  enemy.facing = rotateToward(enemy.facing, Math.atan2(dir.y, dir.x), charger.turnRate * dt);

  if (enemy.aimTimer > 0) {
    enemy.aimTimer -= dt;
    if (enemy.aimTimer <= 0) {
      enemy.aimTimer = 0;
      enemy.dashTimer = charger.dashTime;
    }
    return; // 웅크리는 동안에는 발이 멎는다. 활잡이가 겨누는 동안 멈춰 서는 것과 같다.
  }

  if (enemy.fireCooldown > 0) enemy.fireCooldown -= dt;
  else if (options.playerAlive && dist <= charger.triggerRange) {
    enemy.aimTimer = charger.windup;
    return;
  }

  // 숨 고르는 동안에만 자리를 잡는다. 경계가 둘인 이유는 활잡이와 같다 —
  // 하나만 두면 그 선 위에서 한 발짝마다 앞뒤로 떨린다.
  //   backoff 안쪽      → 물러난다. 몸을 던진 자리에 붙어 서면 플레이어가 적에게 가린다.
  //   triggerRange 바깥 → 따라붙는다. 쉬는 동안 달아나면 영영 못 잡는다.
  //   그 사이           → 서서 기다린다.
  // 숨을 다 골랐으면 조건 없이 곧장 다가온다 — 활잡이처럼 옆으로 돌지 않는다.
  const move = { x: dir.x, y: dir.y };
  if (enemy.fireCooldown > 0) {
    if (dist < charger.backoff) {
      move.x = -dir.x;
      move.y = -dir.y;
    } else if (dist <= charger.triggerRange) {
      move.x = 0;
      move.y = 0;
    }
  }
  addSeparation(move, enemy, enemies, options.separation);
  moveBy(enemy, move, charger.speed, options);
}

/**
 * 방패병 한 마리 (DESIGN 9번). **활잡이의 박자를 그대로 쓴다** —
 * 다가온다 → 멈춰 서서 겨눈다 → 화살을 놓는다. 여기서 갈리는 것은 셋뿐이다:
 *
 * - **느리게 돈다**(`SHIELD.turnRate`). 방패가 정면만 막으므로, 몸이 도는 속도가
 *   곧 "옆구리가 열리는가"를 정한다. 가까이 붙어 돌면 방패가 못 따라온다.
 * - **옆으로 돌지 않는다.** 활잡이는 사이 구간에서 플레이어를 돌지만(`desiredMove`)
 *   방패병은 버티고 선다. 도는 것은 이 적이 아니라 플레이어여야 한다 —
 *   둘이 함께 돌면 서로의 각이 그대로여서 옆구리가 영영 안 열린다.
 * - **거리가 짧다**(`fireRange` 11 · `approachDistance` 9 · `keepDistance` 6).
 *   돌아갈 수 있는 거리까지 걸어와야 이 적이 요구하는 것이 성립한다.
 *
 * 겨누는 동안 방패가 내려가는 것은 여기 없다 — 그건 화살이 닿는 자리의 일이라
 * `combat.ts`의 `blocksArrow`가 `aimTimer` 하나로 판단한다.
 */
function stepShield(
  enemy: Enemy,
  enemies: readonly Enemy[],
  dir: Vec2,
  dist: number,
  options: EnemyStepOptions,
): EnemyShot | null {
  const { dt, shield } = options;

  enemy.facing = rotateToward(enemy.facing, Math.atan2(dir.y, dir.x), shield.turnRate * dt);

  const blocker = sightBlocker(
    enemy.pos,
    options.playerPos,
    sightWidth(dist, options),
    options.obstacles,
  );
  const shot = updateFiring(
    enemy,
    dist,
    options,
    shield,
    blocker !== null || outOfView(enemy, options.playerPos, options.view),
  );

  // 겨누는 동안에는 멈춰 선다. 활잡이와 같은 예고다.
  //   보이지 않는다 → 옆으로 돌아 시야를 되찾는다 (아래 `clearSightMove`)
  //   approach 바깥 → 다가온다
  //   keep 안쪽     → 물러난다 (몸에 붙어 서면 플레이어가 적에게 가린다)
  //   그 사이       → 버티고 선다
  // 두 경계를 벌려 두지 않으면 그 선 위에서 한 발짝마다 앞뒤로 떤다.
  //
  // **가려 있을 때만 이 적이 옆으로 움직인다.** 평소에 버티고 서는 것은 플레이어가
  // 돌아야 할 상대이기 때문이지만(위 주석), 서로가 서로를 못 보는 동안에는 버틸 정면이
  // 아예 없다 — 기둥만 마주 보고 선 방패병은 방패병이 아니라 기둥의 일부다.
  const move = { x: 0, y: 0 };
  if (enemy.aimTimer <= 0) {
    if (blocker) {
      const around = clearSightMove(
        enemy,
        dir,
        blocker,
        options,
        (shield.keepDistance + shield.approachDistance) / 2,
      );
      move.x = around.x;
      move.y = around.y;
    } else if (dist > shield.approachDistance) {
      move.x = dir.x;
      move.y = dir.y;
    } else if (dist < shield.keepDistance) {
      move.x = -dir.x;
      move.y = -dir.y;
    }
  }
  addSeparation(move, enemy, enemies, options.separation);
  moveBy(enemy, move, shield.speed, options);

  return shot;
}

/**
 * 폭탄병 한 마리 (DESIGN 9번). **돌진형의 박자를 그대로 쓴다** —
 * 곧장 다가온다 → 멈춰 서서 달아오른다 → 터진다. 갈리는 것은 마지막 칸뿐이다.
 *
 * - **곧장 온다.** 물러나지도 옆으로 돌지도 않는다(돌진형과 같다). 거리를 지키는 적이
 *   아니라 지우는 적이라, 거리 구간을 나눌 자리가 없다.
 * - **가림도 화면 밖도 보지 않는다**(돌진형과 같다). 이 적의 예고는 화살이 닿는지와
 *   상관이 없고, 불을 붙이는 자리(3.5m)는 언제나 화면 안이다
 *   (`VIEW.back` 12.3m — `tests/camera.test.ts`가 그 관계를 지킨다).
 * - **한 번 붙은 불은 꺼지지 않는다.** 플레이어가 달아나도 그 자리에서 터진다 —
 *   따라가며 터지면 물러나는 것이 답이 아니게 되고, 그러면 이 적은 피할 수 없는 적이다.
 *
 * **쓰러뜨리면 터지지 않는다.** 심지가 타는 동안 체력이 다하면 `combat.ts`가 눕히고,
 * 여기 오지 않으므로 폭발도 없다. 그것이 "물러나거나 쏘거나"의 쏘는 쪽이다.
 */
function stepBomber(
  enemy: Enemy,
  enemies: readonly Enemy[],
  dir: Vec2,
  dist: number,
  options: EnemyStepOptions,
  result: EnemyStepResult,
): void {
  const { dt, bomber } = options;

  if (enemy.aimTimer > 0) {
    enemy.aimTimer -= dt;
    if (enemy.aimTimer > 0) return; // 타는 동안에는 발이 멎는다. 그 멈춤이 예고다.
    enemy.aimTimer = 0;
    result.blasts.push({
      at: { x: enemy.pos.x, y: enemy.pos.y },
      radius: bomber.blastRadius,
      damage: bomber.damage,
      from: enemy,
    });
    // 제 몸이 폭탄이므로 여기서 눕는다. 화살에 쓰러진 것과 같은 자리로 보내되
    // (`respawnDelay` 뒤에 다시 선다), **처치로 세지 않고 코어도 떨구지 않는다** —
    // 그 둘은 World가 `result.killed`를 보고 하는 일이고, 여기는 그 목록에 들어가지 않는다.
    enemy.alive = false;
    enemy.hp = 0;
    enemy.respawnTimer = options.respawnDelay;
    return;
  }

  // 달아오르는 동안에도 몸은 돈다 — 도는 것이 뜻을 갖지는 않지만(터지는 것은 원이다),
  // 멈춰 선 적이 등을 돌린 채 굳어 있으면 화면에서 고장으로 읽힌다.
  enemy.facing = rotateToward(enemy.facing, Math.atan2(dir.y, dir.x), bomber.turnRate * dt);

  // **불을 붙일 수 없는 동안이 있다**(`fireCooldown`) — 판이 열린 직후(`ENEMY.startDelay`)와
  // 일어선 사람 앞에서 기다리는 동안(`REVIVE.enemyDelay`)이다. 활잡이가 겨누지 않고
  // 돌진형이 웅크리지 않는 그 시간에 이 적만 터지면, 기다려 주기로 한 것이 헛것이 된다.
  if (enemy.fireCooldown > 0) enemy.fireCooldown -= dt;
  else if (options.playerAlive && dist <= bomber.triggerRange) {
    enemy.aimTimer = bomber.fuse;
    return;
  }

  // 기다리는 동안에는 붙어 선 자리에서 멈춘다. 계속 걸어가면 몸이 플레이어에 겹쳐
  // 서서 비비는 그림이 되고(돌진형이 `backoff`로 막아 둔 그것이다), 기다림이 끝나는
  // 순간 코앞에서 터진다 — 물러날 자리가 이미 없다.
  const move = dist <= bomber.triggerRange ? { x: 0, y: 0 } : { x: dir.x, y: dir.y };
  addSeparation(move, enemy, enemies, options.separation);
  moveBy(enemy, move, bomber.speed, options);
}

/**
 * 약탈꾼 한 마리 (DESIGN 9번). **문법은 앞의 넷과 똑같고, 향하는 곳만 다르다** —
 * 다가간다 → 멈춰 서서 웅크린다 → 코어를 삼킨다.
 *
 * - **플레이어를 보지 않는다.** 다섯 중 유일하게 몸이 플레이어를 향해 돌지 않는다
 *   (나머지 넷은 `rotateToward(..., 플레이어)`가 첫 줄이다). 가는 쪽으로 돌 뿐이라,
 *   화면에서 이 적은 **등을 보이고 걷는다** — 그것이 이 적을 알아보는 첫 표지다.
 * - **때리지 않는다.** 화살도 몸통도 폭발도 없다. 가져가는 것은 경험치뿐이고,
 *   그래서 이 적을 세우는 값은 체력이 아니라 **플레이어가 걸어야 하는 거리**다.
 * - **플레이어 곁의 코어는 건드리지 않는다**(`guard`). 발밑의 것까지 집어 가면
 *   가만히 선 채로 잡히는 적이 되고, 무엇보다 손에 닿기 직전의 코어가 증발한다.
 * - **훔칠 것이 없으면 물러나 선다**(`standOff`). 할 일 없이 곁에 서 있으면
 *   아프지 않은 적이 자동 조준을 가로챈다(`systems/autoAim.ts`는 가장 가까운 적을 잡는다).
 *
 * **삼키는 동안 쓰러뜨리면 코어는 그 자리에 남는다.** 체력이 다하면 `combat.ts`가 눕히고
 * 여기 오지 않으므로 `result.steals`에 아무것도 담기지 않는다 — 심지가 타는 동안
 * 쓰러진 폭탄병이 터지지 않는 것과 **같은 자리**다. 그것이 이 예고의 값이다.
 */
function stepLooter(
  enemy: Enemy,
  enemies: readonly Enemy[],
  dir: Vec2,
  dist: number,
  options: EnemyStepOptions,
  result: EnemyStepResult,
): void {
  const { dt, looter } = options;

  if (enemy.aimTimer > 0) {
    enemy.aimTimer -= dt;
    if (enemy.aimTimer > 0) return; // 삼키는 동안에는 발이 멎는다. 그 멈춤이 예고다.
    enemy.aimTimer = 0;
    // **삼키는 사이에 플레이어가 주워 갔을 수 있다.** 그래서 코어를 기억해 두지 않고
    // 끝나는 순간 다시 찾는다 — 없으면 아무 일도 없었던 것이 된다(빈손으로 일어선다).
    const core = nearestLoot(enemy, options, looter.reach);
    if (core) result.steals.push({ core, by: enemy });
    return;
  }

  const target = nearestLoot(enemy, options, Infinity);
  if (target) {
    const toCore = { x: target.pos.x - enemy.pos.x, y: target.pos.y - enemy.pos.y };
    const gap = length(toCore);
    enemy.facing = rotateToward(enemy.facing, Math.atan2(toCore.y, toCore.x), looter.turnRate * dt);
    if (gap <= looter.reach) {
      enemy.aimTimer = looter.swallow;
      return;
    }
    addSeparation(toCore, enemy, enemies, options.separation);
    moveBy(enemy, toCore, looter.speed, options);
    return;
  }

  // 훔칠 것이 없다. 플레이어에게서 `standOff`까지 물러나 서서 다음 코어를 기다린다.
  const move = dist < looter.standOff ? { x: -dir.x, y: -dir.y } : { x: 0, y: 0 };
  // 여기서도 도는 쪽은 **가는 쪽**이다. 서 있을 때는 보던 쪽을 그대로 본다 —
  // 할 일이 없어졌다고 플레이어를 돌아보면 "이제 나를 노린다"는 거짓말이 된다.
  if (move.x !== 0 || move.y !== 0) {
    enemy.facing = rotateToward(enemy.facing, Math.atan2(move.y, move.x), looter.turnRate * dt);
  }
  addSeparation(move, enemy, enemies, options.separation);
  moveBy(enemy, move, looter.speed, options);
}

/**
 * 약탈꾼이 노릴 코어 하나 — **제게서 가장 가깝고, 플레이어에게서 `guard` 밖에 있는 것.**
 * 하나도 없으면 null이다.
 *
 * `maxDist`는 두 가지로 쓴다: 목표를 고를 때는 Infinity(맵 전체에서 고른다),
 * 삼킴이 끝나는 순간에는 `reach`(손이 닿는 자리에 아직 있는가).
 *
 * 순서가 정해져 있다(같은 거리면 먼저 생긴 코어). 난수를 쓰지 않으므로 같은 판은 늘
 * 같은 그림이고, `npm run perf`의 표가 씨앗 하나에 매번 같은 값을 낸다.
 */
function nearestLoot(
  enemy: Enemy,
  options: EnemyStepOptions,
  maxDist: number,
): XpCore | null {
  const { cores, playerPos, looter } = options;
  const guardSq = looter.guard * looter.guard;
  const maxSq = maxDist === Infinity ? Infinity : maxDist * maxDist;
  let best: XpCore | null = null;
  let bestSq = Infinity;
  for (const core of cores) {
    if (!core.alive) continue;
    const px = core.pos.x - playerPos.x;
    const py = core.pos.y - playerPos.y;
    if (px * px + py * py <= guardSq) continue;
    const dx = core.pos.x - enemy.pos.x;
    const dy = core.pos.y - enemy.pos.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxSq || distSq >= bestSq) continue;
    bestSq = distSq;
    best = core;
  }
  return best;
}

function distanceTo(enemy: Enemy, point: Vec2): number {
  return Math.hypot(point.x - enemy.pos.x, point.y - enemy.pos.y);
}

/**
 * 방향(정규화하지 않은 것도 받는다)과 속력으로 한 스텝 움직이고 설 수 있는 자리에 앉힌다.
 * 벽과 기둥을 자르는 일은 **플레이어와 같은 함수가 한다**(`settleBody`).
 * 여기서 따로 만들면 적만 기둥을 뚫고 지나가는 고장이 조용히 생긴다.
 */
function moveBy(enemy: Enemy, move: Vec2, speed: number, options: EnemyStepOptions): void {
  const moveLen = length(move);
  if (moveLen <= 1e-6) return;
  const step = (speed * options.dt) / moveLen;
  enemy.pos = settleBody(
    { x: enemy.pos.x + move.x * step, y: enemy.pos.y + move.y * step },
    options.arenaRadius,
    options.bodyRadius,
    options.obstacles,
  );
}

/** 쓰러진 적을 `standAt`에 다시 세운다. 체력도 방패도 타이머도 함께 되돌린다. */
function revive(enemy: Enemy, options: EnemyStepOptions): void {
  enemy.alive = true;
  enemy.hp = enemy.maxHp;
  // 방패도 함께 돌아온다. 부서진 채로 다시 서면 그 판의 방패병은 두 번째부터
  // 그냥 느린 활잡이가 되어, 이 적이 요구하는 것이 한 번 쓰고 사라진다.
  enemy.shieldHp = enemy.kind === 'shield' ? options.shield.shieldHp : 0;
  enemy.shieldFlash = 0;
  enemy.pos = { x: enemy.standAt.x, y: enemy.standAt.y };
  enemy.respawnTimer = 0;
  enemy.aimTimer = 0;
  enemy.fireCooldown = 0;
  // 돌진 중에 쓰러졌으면 그 돌진은 여기서 끝난다. 남겨 두면 되살아나자마자
  // 제자리에서 예고 없이 튀어나간다 — 예고가 있어야 피할 수 있다는 규칙이 깨진다.
  enemy.dashTimer = 0;
}

/**
 * 겨누기와 쏘기. 사거리 안이고 쿨다운이 끝났으면 겨누기 시작하고,
 * 겨누기가 끝나는 순간 화살 하나를 돌려준다.
 *
 * **활잡이와 방패병이 이 함수 하나를 함께 쓴다.** 박자만 `timing`으로 갈린다
 * (활잡이는 `options` 자신을, 방패병은 `options.shield`를 건넨다 —
 * 프레임마다 객체를 새로 만들지 않으려고 이름을 맞춰 두었다).
 * 화살의 흔들림·총구 위치는 종류를 가리지 않으므로 `options`에서 그대로 읽는다.
 */
function updateFiring(
  enemy: Enemy,
  dist: number,
  options: EnemyStepOptions,
  timing: FiringTiming,
  /**
   * **플레이어가 이 적의 예고를 볼 수 없는가.** 두 가지가 여기 하나로 묶인다 —
   * 기둥에 가려 화살이 닿지 못하거나(DESIGN 10번 · `sightBlocker`),
   * 적이 화면 밖에 서 있거나(`outOfView`). 둘 중 하나라도 참이면
   * **겨누기를 시작하지 않는다.**
   *
   * **이미 겨누고 있던 것은 끝까지 놓는다.** 겨눔은 "지금 너를 노린다"는 약속이고,
   * 그 0.5초 사이에 기둥 뒤로 몸을 숨긴 사람도, 달려서 화면 밖으로 밀어낸 사람도
   * **약속을 보고 피한 것**이다 — 여기서 거둬들이면 예고가 거짓이 되고,
   * 피한 것이 피한 것으로 세어지지 않는다.
   */
  unseen: boolean,
): EnemyShot | null {
  if (enemy.aimTimer > 0) {
    enemy.aimTimer -= options.dt;
    if (enemy.aimTimer > 0) return null;
    enemy.aimTimer = 0;
    enemy.fireCooldown = timing.fireCooldown;
    // 조준을 조금 흔든다. 정확히 겨누면 멈춰 선 순간 무조건 맞아서 대응할 여지가 없다.
    const angle = enemy.facing + (options.random() * 2 - 1) * options.spread;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    return {
      pos: {
        x: enemy.pos.x + dir.x * options.muzzleOffset,
        y: enemy.pos.y + dir.y * options.muzzleOffset,
      },
      dir,
    };
  }

  if (enemy.fireCooldown > 0) enemy.fireCooldown -= options.dt;
  if (!unseen && enemy.fireCooldown <= 0 && options.playerAlive && dist <= timing.fireRange) {
    enemy.aimTimer = timing.aimTime;
  }
  return null;
}

/** 거리 구간에 따른 이동 방향(정규화하지 않는다 — 뒤에서 밀어내기를 더한다). */
function desiredMove(
  enemy: Enemy,
  dir: Vec2,
  dist: number,
  options: EnemyStepOptions,
  /** 시야를 막고 있는 기둥. null이면 보인다. */
  blocker: Obstacle | null,
): Vec2 {
  if (dist > options.approachDistance) return { x: dir.x, y: dir.y };
  // **보이지 않으면 거리 구간보다 이것이 먼저다.** 가려 있는데 물러나거나 느릿느릿 도는 것은
  // 그 자리에 눌러앉는 것과 같다 — 기둥 뒤가 요새가 되는 것이 바로 거기서 온다.
  // 옆걸음은 `strafeRatio`를 쓰지 않고 **전속력**이다. 시야를 되찾는 동안에는 쏘지 못하므로,
  // 여기서 굼뜨면 그 시간만큼 아무 일도 일어나지 않는다.
  if (blocker)
    return clearSightMove(
      enemy,
      dir,
      blocker,
      options,
      (options.keepDistance + options.approachDistance) / 2,
    );
  if (dist < options.keepDistance) return { x: -dir.x, y: -dir.y };
  // 사이 구간: 플레이어를 중심으로 옆으로 돈다. 도는 방향은 적마다 갈라 두어
  // 전부 같은 쪽으로 돌면서 한 줄로 뭉치는 것을 막는다.
  const side = enemy.id % 2 === 0 ? 1 : -1;
  return { x: -dir.y * side * options.strafeRatio, y: dir.x * side * options.strafeRatio };
}

/**
 * **플레이어의 화면 밖에 서 있는가.** 그렇다면 겨누기를 시작하지 않는다(DESIGN 품질 기준의
 * "처음 하는 사람이 설명 없이 30초 안에" — 예고를 볼 수 없으면 피할 방법이 없다).
 *
 * **화면 세로 방향만 본다.** 쿼터뷰 카메라는 돌지 않으므로 화면의 위아래가 곧 월드의 -y/+y다.
 * 좌우를 보지 않는 이유는 `VIEW` 주석에 있다 — 겨누는 거리(15m) 안에서는 좌우가 한 번도
 * 걸리지 않는다(가장 좁은 16:9에서도 화면 맨 아랫줄의 폭이 ±12.5m다).
 *
 * **거리가 아니라 자리로 재는 이유**: `fireRange`를 줄이면 사방이 함께 줄어든다. 안 보이는
 * 것은 한 방향뿐인데(실측 — 화면 아래쪽 칸 42.5% · 나머지 일곱 칸 0~3.0%) 사방을 줄이면
 * 적이 전부 3m씩 더 파고들어야 하는 다른 게임이 된다.
 *
 * **움직임은 이 값을 보지 않는다.** 화면 밖이면 곧 `approachDistance`(12) 밖이므로
 * (`VIEW.back` 12.3 > 12) 적은 이미 다가오는 중이다 — 가만히 굳는 자리가 생기지 않는다.
 * 그 관계는 `tests/camera.test.ts`가 지킨다.
 */
function outOfView(enemy: Enemy, playerPos: Vec2, view: ViewWindow): boolean {
  const dy = enemy.pos.y - playerPos.y;
  return dy > view.back || dy < -view.forward;
}

/**
 * 시야를 잴 때 쓰는 **화살이 지나갈 길의 굵기**(m).
 *
 * 화살의 몸(`arrowRadius`)만으로는 좁다. 조준이 `spread`만큼 흔들리므로(`updateFiring`)
 * 겨우 기둥 끝을 스치는 각에서 쏘면 **흔들린 쪽 절반이 기둥에 박힌다** — 실측으로 그 자리의
 * 적은 쏜 화살의 25~50%를 기둥에 먹였다. 그것은 쏜 것이 아니라 버린 것이다.
 *
 * 그래서 거리가 멀수록 넓게 본다(`dist * spread` = 그 거리에서 흔들림이 벌어지는 폭).
 * 적은 **흔들림까지 지나갈 길이 보일 때** 겨누기 시작하고, 그 전에는 한 걸음 더 돌아 나온다.
 */
function sightWidth(dist: number, options: EnemyStepOptions): number {
  return options.arrowRadius + dist * options.spread;
}

/**
 * 가려 있을 때 어디로 걷는가 — **보이는 자리 중 가장 먼 고리로 간다.**
 *
 * 플레이어를 둘러싼 고리 위에 열두 자리를 놓고, 그중 **지금 자리에서 가장 가까우면서
 * 플레이어가 보이는 자리**로 걷는다. 고리는 평소 서는 거리(물러나는 선과 다가오는 선의
 * 가운데)에서 시작해 **보이는 자리가 하나도 없으면 한 칸씩 좁힌다.**
 *
 * **고리를 좁히는 것이 이 함수의 전부다.** 기둥에 몸을 붙이고 선 사람은 평소 거리에서는
 * 어느 방향에서도 보이지 않는다 — 실측으로 그 자리의 10m 고리는 열둘 중 **다섯이 벽 밖,
 * 일곱이 가림**이고, 보이는 자리가 처음 나오는 것은 6m다. 거기까지 들어가야 쏠 수 있고,
 * 들어간 만큼 플레이어의 화살에도 가까워진다 — **가려 선다는 것은 그 거래를 거는 것**이지
 * 안전을 사는 것이 아니어야 한다.
 *
 * **왜 방향만 정해서는 안 되는가**(세 번 재서 알았다). 셋 다 도착점이 없어서 실패했다:
 * - 거리를 지킨 채 옆으로 돌기 — 그 자리는 대개 벽 앞이라 고리의 대부분이 아레나 밖이다.
 *   적이 벽에 눌려 제자리를 긁는다(실측 **초당 0.08발** · 트인 자리 0.86발).
 * - 기둥 옆구리로 가기 — 기둥에 붙어 선 사람은 기둥 옆에서도 안 보인다(원을 낀 두 점).
 * - 비스듬히 파고들기 — 모퉁이는 돌지만, 보이는 자리를 목표로 삼지 않아 그냥 걸어 들어와
 *   플레이어의 화살에 눕는다(초당 0.13발).
 *
 * 열두 자리는 각도로 못 박혀 있어(적마다 돌리지 않는다) 적이 여럿이어도 고르는 자리가
 * 같고, 겹친 몸은 밀어내기가 흩는다(`addSeparation`). 결정적이라 같은 판은 늘 같은 그림이다.
 *
 * 가장 좁은 고리에도 자리가 없으면(요새가 생긴 맵) 비스듬히 파고든다 — 곧장 다가가기만
 * 하면 기둥에 코를 박고 멈춘다(`pushOutOfObstacles`는 중심 밖으로만 민다).
 */
const VANTAGE_COUNT = 12;
/** 고리를 좁혀 가는 비율(평소 서는 거리에 대한). 마지막 0.3은 몸이 닿기 직전이다. */
const VANTAGE_RINGS = [1, 0.8, 0.6, 0.4, 0.3] as const;

function clearSightMove(
  enemy: Enemy,
  dir: Vec2,
  blocker: Obstacle,
  options: EnemyStepOptions,
  standRing: number,
): Vec2 {
  const { playerPos, obstacles } = options;
  const limit = options.arenaRadius - options.bodyRadius;
  for (const scale of VANTAGE_RINGS) {
    const ring = standRing * scale;
    const width = sightWidth(ring, options);
    let best: Vec2 | null = null;
    let bestSq = Infinity;
    for (let i = 0; i < VANTAGE_COUNT; i += 1) {
      const a = (i * Math.PI * 2) / VANTAGE_COUNT;
      const at = { x: playerPos.x + Math.cos(a) * ring, y: playerPos.y + Math.sin(a) * ring };
      if (length(at) > limit) continue;
      if (insideObstacle(at, options.bodyRadius, obstacles)) continue;
      if (sightBlocker(at, playerPos, width, obstacles)) continue;
      const dx = at.x - enemy.pos.x;
      const dy = at.y - enemy.pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= bestSq) continue;
      bestSq = distSq;
      best = { x: dx, y: dy };
    }
    if (best) return best;
  }
  const side = clearSide(enemy, dir, blocker);
  return { x: dir.x - dir.y * side, y: dir.y + dir.x * side };
}

/**
 * 기둥을 **어느 쪽으로 끼고 돌 것인가**(+1 = 왼쪽 · -1 = 오른쪽).
 *
 * 막은 기둥이 시선의 왼쪽에 있으면 오른쪽으로 돈다 — 그래야 시선과 기둥 사이가 벌어진다.
 * 반대로 돌면 기둥의 몸통을 가로질러야 해서 그 지름만큼(6.4m) 더 걷는다.
 *
 * 기둥이 시선 위에 정확히 놓였을 때만 고를 근거가 없다. 그때는 `desiredMove`가 옆으로 돌 때
 * 쓰는 것과 **같은 쪽**(적마다 갈라 둔 `id` 짝수/홀수)을 쓴다 — 여기서 따로 정하면
 * 시야가 열리고 닫힐 때마다 도는 쪽이 뒤집혀 제자리에서 떤다.
 */
function clearSide(enemy: Enemy, dir: Vec2, blocker: Obstacle): number {
  // 기둥이 시선에서 얼마나 옆으로 비켜 있는가(왼쪽이 양수).
  const offset = -dir.y * (blocker.x - enemy.pos.x) + dir.x * (blocker.y - enemy.pos.y);
  if (Math.abs(offset) < 1e-6) return enemy.id % 2 === 0 ? 1 : -1;
  return offset > 0 ? -1 : 1;
}

/**
 * 서로 겹치지 않게 밀어낸다. 겹쳐 서면 화살 한 발이 여럿을 맞히고,
 * 화면에서는 적 하나가 두 겹으로 보인다.
 */
function addSeparation(move: Vec2, self: Enemy, enemies: readonly Enemy[], radius: number): void {
  const radiusSq = radius * radius;
  for (const other of enemies) {
    if (other === self || !other.alive) continue;
    const dx = self.pos.x - other.pos.x;
    const dy = self.pos.y - other.pos.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= radiusSq) continue;
    if (distSq < 1e-6) {
      // 정확히 같은 자리에 겹쳤다. 방향이 없으므로 각자 다른 쪽으로 흩어 놓는다.
      move.x += Math.cos(self.id);
      move.y += Math.sin(self.id);
      continue;
    }
    const dist = Math.sqrt(distSq);
    // 가까울수록 세게 민다. 경계에서는 0이라 밀려나자마자 멈춘다.
    const push = (radius - dist) / radius;
    move.x += (dx / dist) * push * 1.6;
    move.y += (dy / dist) * push * 1.6;
  }
}

