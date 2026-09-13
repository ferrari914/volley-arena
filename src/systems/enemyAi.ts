import { clamp, length, rotateToward, type Vec2 } from '../core/math';
import type { Enemy, Obstacle } from '../entities/types';
import { pushOutOfObstacles } from './obstacles';

/**
 * 적 봇의 행동 (DESIGN 5번 · 9번).
 *
 * 규칙은 셋뿐이다 — **다가온다 · 예고한다 · 저지른다.**
 * 상태를 따로 두지 않고 타이머로만 굴린다(`aimTimer`·`fireCooldown`, 돌진형은 `dashTimer`).
 *
 * 종류가 셋으로 늘었지만(DESIGN 9번) 이 문법은 그대로다. 갈리는 것은 마지막 한 칸,
 * **무엇을 저지르는가**뿐이다:
 *   활잡이(archer)   — 멈춰 서서 겨눈 뒤 → 화살을 놓는다
 *   돌진형(charger)  — 멈춰 서서 웅크린 뒤 → 몸을 던진다
 *   방패병(shield)   — 멈춰 서서 겨눈 뒤 → 화살을 놓는다 (활잡이와 같다)
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
 * **돌진형에는 이 구간이 없다.** 물러나지도 옆으로 돌지도 않고 곧장 온다 —
 * 그것이 활잡이와 정반대인 지점이고, 둘이 함께 있어야 하는 이유다.
 */
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
  /** 이 맵에 선 기둥들(DESIGN 10번). 적의 몸도 플레이어와 같은 규칙으로 막힌다. */
  obstacles: readonly Obstacle[];
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
 * 이번 스텝에 적이 한 일. 화살도 몸통 박치기도 여기서 만들지 않고 돌려주기만 한다 —
 * 화살의 id·속도·수명과 플레이어의 무적 규칙은 World와 `combat.ts`가 쥐고 있고,
 * 그래야 이 함수가 그것들을 몰라도 되어 테스트에서 적만 따로 돌려볼 수 있다.
 */
export interface EnemyStepResult {
  shots: EnemyShot[];
  /** 돌진형이 몸으로 닿힌 피해량들. 무적 판정은 받는 쪽이 한다. */
  contacts: number[];
}

/** 적을 한 스텝 움직이고, 이번에 저지른 것들을 돌려준다. */
export function stepEnemies(enemies: Enemy[], options: EnemyStepOptions): EnemyStepResult {
  const { dt, playerPos } = options;
  const result: EnemyStepResult = { shots: [], contacts: [] };

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

    // 몸은 늘 플레이어를 향해 돈다. 화살은 몸이 보는 쪽으로 나가므로,
    // 방금 등 뒤로 돌아간 플레이어를 곧바로 맞히지 못한다 — 그 틈이 회피의 여지다.
    enemy.facing = rotateToward(
      enemy.facing,
      Math.atan2(dir.y, dir.x),
      options.turnRate * dt,
    );

    const shot = updateFiring(enemy, dist, options, options);
    if (shot) result.shots.push(shot);

    // 겨누는 동안에는 멈춰 선다. 이것이 "지금 나를 노리고 있다"는 유일한 예고다.
    const move = enemy.aimTimer > 0 ? { x: 0, y: 0 } : desiredMove(enemy, dir, dist, options);
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

  const shot = updateFiring(enemy, dist, options, shield);

  // 겨누는 동안에는 멈춰 선다. 활잡이와 같은 예고다.
  //   approach 바깥 → 다가온다
  //   keep 안쪽     → 물러난다 (몸에 붙어 서면 플레이어가 적에게 가린다)
  //   그 사이       → 버티고 선다
  // 두 경계를 벌려 두지 않으면 그 선 위에서 한 발짝마다 앞뒤로 떤다.
  const move = { x: 0, y: 0 };
  if (enemy.aimTimer <= 0) {
    if (dist > shield.approachDistance) {
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

function distanceTo(enemy: Enemy, point: Vec2): number {
  return Math.hypot(point.x - enemy.pos.x, point.y - enemy.pos.y);
}

/**
 * 방향(정규화하지 않은 것도 받는다)과 속력으로 한 스텝 움직이고 벽 안쪽으로 자른다.
 * 기둥에서도 밀려난다(DESIGN 10번) — **플레이어와 같은 함수를 쓴다**(`pushOutOfObstacles`).
 * 여기서 따로 만들면 적만 기둥을 뚫고 지나가는 고장이 조용히 생긴다.
 */
function moveBy(enemy: Enemy, move: Vec2, speed: number, options: EnemyStepOptions): void {
  const moveLen = length(move);
  if (moveLen <= 1e-6) return;
  const step = (speed * options.dt) / moveLen;
  enemy.pos = { x: enemy.pos.x + move.x * step, y: enemy.pos.y + move.y * step };
  clampToArena(enemy, options.arenaRadius - options.bodyRadius);
  enemy.pos = pushOutOfObstacles(enemy.pos, options.bodyRadius, options.obstacles);
}

/** 쓰러진 적을 제자리에 다시 세운다. 체력도 방패도 타이머도 함께 되돌린다. */
function revive(enemy: Enemy, options: EnemyStepOptions): void {
  enemy.alive = true;
  enemy.hp = enemy.maxHp;
  // 방패도 함께 돌아온다. 부서진 채로 다시 서면 그 판의 방패병은 두 번째부터
  // 그냥 느린 활잡이가 되어, 이 적이 요구하는 것이 한 번 쓰고 사라진다.
  enemy.shieldHp = enemy.kind === 'shield' ? options.shield.shieldHp : 0;
  enemy.shieldFlash = 0;
  enemy.pos = { x: enemy.home.x, y: enemy.home.y };
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
  if (enemy.fireCooldown <= 0 && options.playerAlive && dist <= timing.fireRange) {
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
): Vec2 {
  if (dist > options.approachDistance) return { x: dir.x, y: dir.y };
  if (dist < options.keepDistance) return { x: -dir.x, y: -dir.y };
  // 사이 구간: 플레이어를 중심으로 옆으로 돈다. 도는 방향은 적마다 갈라 두어
  // 전부 같은 쪽으로 돌면서 한 줄로 뭉치는 것을 막는다.
  const side = enemy.id % 2 === 0 ? 1 : -1;
  return { x: -dir.y * side * options.strafeRatio, y: dir.x * side * options.strafeRatio };
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

/** 적도 벽을 넘지 않는다. 플레이어와 같은 규칙(각도는 두고 반지름만 자른다). */
function clampToArena(enemy: Enemy, limit: number): void {
  const dist = length(enemy.pos);
  if (dist <= limit) return;
  const scale = clamp(Math.max(limit, 0) / dist, 0, 1);
  enemy.pos = { x: enemy.pos.x * scale, y: enemy.pos.y * scale };
}
