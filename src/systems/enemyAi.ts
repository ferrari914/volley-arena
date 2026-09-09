import { clamp, length, rotateToward, type Vec2 } from '../core/math';
import type { Enemy } from '../entities/types';

/**
 * 적 봇의 행동 (DESIGN 5번 · 9번).
 *
 * 규칙은 셋뿐이다 — **다가온다 · 예고한다 · 저지른다.**
 * 상태를 따로 두지 않고 타이머로만 굴린다(`aimTimer`·`fireCooldown`, 돌진형은 `dashTimer`).
 *
 * 종류가 둘로 늘었지만(DESIGN 9번) 이 문법은 그대로다. 갈리는 것은 마지막 한 칸,
 * **무엇을 저지르는가**뿐이다:
 *   활잡이(archer)   — 멈춰 서서 겨눈 뒤 → 화살을 놓는다
 *   돌진형(charger)  — 멈춰 서서 웅크린 뒤 → 몸을 던진다
 * 예고 칸을 종류마다 다시 만들지 않은 이유: 예고 없이 아픈 적은 피할 방법이 없고,
 * 예고의 모양이 종류마다 다르면 처음 하는 사람이 매번 새로 배워야 한다.
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
  damage: number;
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

    if (!enemy.alive) {
      enemy.respawnTimer -= dt;
      if (enemy.respawnTimer <= 0) revive(enemy);
      continue;
    }

    const toPlayer = { x: playerPos.x - enemy.pos.x, y: playerPos.y - enemy.pos.y };
    const dist = length(toPlayer);
    const dir = dist > 1e-6 ? { x: toPlayer.x / dist, y: toPlayer.y / dist } : { x: 1, y: 0 };

    if (enemy.kind === 'charger') {
      stepCharger(enemy, enemies, dir, dist, options, result);
      continue;
    }

    // 몸은 늘 플레이어를 향해 돈다. 화살은 몸이 보는 쪽으로 나가므로,
    // 방금 등 뒤로 돌아간 플레이어를 곧바로 맞히지 못한다 — 그 틈이 회피의 여지다.
    enemy.facing = rotateToward(
      enemy.facing,
      Math.atan2(dir.y, dir.x),
      options.turnRate * dt,
    );

    const shot = updateFiring(enemy, dist, options);
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

  // 그 밖에는 곧장 다가온다. 물러나지도, 옆으로 돌지도 않는다.
  const move = { x: dir.x, y: dir.y };
  addSeparation(move, enemy, enemies, options.separation);
  moveBy(enemy, move, charger.speed, options);
}

function distanceTo(enemy: Enemy, point: Vec2): number {
  return Math.hypot(point.x - enemy.pos.x, point.y - enemy.pos.y);
}

/** 방향(정규화하지 않은 것도 받는다)과 속력으로 한 스텝 움직이고 벽 안쪽으로 자른다. */
function moveBy(enemy: Enemy, move: Vec2, speed: number, options: EnemyStepOptions): void {
  const moveLen = length(move);
  if (moveLen <= 1e-6) return;
  const step = (speed * options.dt) / moveLen;
  enemy.pos = { x: enemy.pos.x + move.x * step, y: enemy.pos.y + move.y * step };
  clampToArena(enemy, options.arenaRadius - options.bodyRadius);
}

/** 쓰러진 적을 제자리에 다시 세운다. 체력도 타이머도 함께 되돌린다. */
function revive(enemy: Enemy): void {
  enemy.alive = true;
  enemy.hp = enemy.maxHp;
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
 */
function updateFiring(enemy: Enemy, dist: number, options: EnemyStepOptions): EnemyShot | null {
  if (enemy.aimTimer > 0) {
    enemy.aimTimer -= options.dt;
    if (enemy.aimTimer > 0) return null;
    enemy.aimTimer = 0;
    enemy.fireCooldown = options.fireCooldown;
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
  if (enemy.fireCooldown <= 0 && options.playerAlive && dist <= options.fireRange) {
    enemy.aimTimer = options.aimTime;
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
