import { clamp, length, rotateToward, type Vec2 } from '../core/math';
import type { Enemy } from '../entities/types';

/**
 * 적 봇의 행동 (DESIGN 5번).
 *
 * 규칙은 셋뿐이다 — **다가온다 · 겨눈다 · 쏜다.**
 * 상태를 따로 두지 않고 타이머 두 개(`aimTimer`·`fireCooldown`)로만 굴린다.
 * 상태 기계를 세우면 적 종류를 늘릴 때(DESIGN 9번)마다 분기가 늘어나는데,
 * 지금 필요한 것은 "쫓아와서 쏜다" 하나다.
 *
 * 거리를 세 구간으로 나눈다:
 *   멀다(> approach)        → 다가온다
 *   가깝다(< keep)          → 물러난다
 *   사이                    → 옆으로 돈다
 * 두 경계 사이를 벌려 두지 않으면 적이 한 발짝마다 앞뒤로 떨린다.
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
  /** 조준을 흔드는 데 쓴다. World의 씨앗 고정 난수가 들어온다. */
  random: () => number;
}

/** 이번 스텝에 적이 쏜 화살 하나. World가 이것을 받아 실제 화살로 만든다. */
export interface EnemyShot {
  pos: Vec2;
  dir: Vec2;
}

/**
 * 적을 한 스텝 움직이고, 이번에 쏜 화살들을 돌려준다.
 *
 * 화살을 여기서 만들지 않고 돌려주기만 하는 이유: 화살의 id·속도·수명은 World가 쥐고 있고,
 * 그래야 이 함수가 World를 몰라도 되어 테스트에서 적만 따로 돌려볼 수 있다.
 */
export function stepEnemies(enemies: Enemy[], options: EnemyStepOptions): EnemyShot[] {
  const { dt, playerPos, arenaRadius } = options;
  const shots: EnemyShot[] = [];

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

    // 몸은 늘 플레이어를 향해 돈다. 화살은 몸이 보는 쪽으로 나가므로,
    // 방금 등 뒤로 돌아간 플레이어를 곧바로 맞히지 못한다 — 그 틈이 회피의 여지다.
    enemy.facing = rotateToward(
      enemy.facing,
      Math.atan2(dir.y, dir.x),
      options.turnRate * dt,
    );

    const shot = updateFiring(enemy, dist, options);
    if (shot) shots.push(shot);

    // 겨누는 동안에는 멈춰 선다. 이것이 "지금 나를 노리고 있다"는 유일한 예고다.
    const move = enemy.aimTimer > 0 ? { x: 0, y: 0 } : desiredMove(enemy, dir, dist, options);
    addSeparation(move, enemy, enemies, options.separation);

    const moveLen = length(move);
    if (moveLen > 1e-6) {
      const step = (options.speed * dt) / moveLen;
      enemy.pos = { x: enemy.pos.x + move.x * step, y: enemy.pos.y + move.y * step };
      clampToArena(enemy, arenaRadius - options.bodyRadius);
    }
  }

  return shots;
}

/** 쓰러진 적을 제자리에 다시 세운다. 체력도 함께 되돌린다. */
function revive(enemy: Enemy): void {
  enemy.alive = true;
  enemy.hp = enemy.maxHp;
  enemy.pos = { x: enemy.home.x, y: enemy.home.y };
  enemy.respawnTimer = 0;
  enemy.aimTimer = 0;
  enemy.fireCooldown = 0;
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
