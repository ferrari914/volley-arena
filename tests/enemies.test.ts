import { describe, expect, it } from 'vitest';
import { ARENA, CHARGER, ENEMY, PLAYER } from '../src/data/config';
import { createEnemy, type Enemy } from '../src/entities/types';
import { stepEnemies, type EnemyStepOptions } from '../src/systems/enemyAi';

const DT = 1 / 60;

let nextId = 1;
const enemyAt = (x: number, y: number): Enemy => createEnemy(nextId++, x, y, ENEMY.maxHp);
/** 돌진형 한 마리(DESIGN 9번). 활잡이와 같은 자리에 세워 두고 행동만 비교한다. */
const chargerAt = (x: number, y: number): Enemy =>
  createEnemy(nextId++, x, y, CHARGER.maxHp, 'charger');

function options(overrides: Partial<EnemyStepOptions> = {}): EnemyStepOptions {
  return {
    dt: DT,
    playerPos: { x: 0, y: 0 },
    playerAlive: true,
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
    // 흔들림 없이 곧장 겨눈다. 판정을 볼 때 난수가 끼면 무엇을 보고 있는지 흐려진다.
    random: () => 0.5,
    ...overrides,
  };
}

/** seconds초 동안 돌리고 그동안 쏜 화살을 모아 돌려준다. */
function run(enemies: Enemy[], seconds: number, overrides: Partial<EnemyStepOptions> = {}) {
  const shots = [];
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    shots.push(...stepEnemies(enemies, options(overrides)).shots);
  }
  return shots;
}

/** seconds초 동안 돌리고 돌진형이 몸으로 닿힌 피해를 모아 돌려준다(DESIGN 9번). */
function runContacts(enemies: Enemy[], seconds: number, overrides: Partial<EnemyStepOptions> = {}) {
  const contacts: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    contacts.push(...stepEnemies(enemies, options(overrides)).contacts);
  }
  return contacts;
}

/**
 * 움직임만 보고 싶을 때. 사거리를 0으로 두면 겨누지 않으므로 멈춰 서지 않는다 —
 * 그러지 않으면 "다가온다/물러난다"를 재는 동안 적이 겨누느라 서 있어서
 * 무엇을 보고 있는지 알 수 없다.
 */
const MOVE_ONLY: Partial<EnemyStepOptions> = { fireRange: 0 };

/**
 * 첫 발이 나오는 순간 멈추고, 쏘기 직전의 적의 자리를 함께 돌려준다.
 * 적은 쏜 뒤에도 같은 스텝 안에서 한 발짝 움직이므로, 나중에 위치를 읽으면
 * 화살이 몸에서 얼마나 앞에 생겼는지를 잴 수 없다.
 */
function runUntilShot(enemy: Enemy, maxSeconds: number) {
  for (let i = 0; i < Math.round(maxSeconds / DT); i += 1) {
    const before = { ...enemy.pos };
    const { shots } = stepEnemies([enemy], options());
    if (shots.length > 0) return { shots, before };
  }
  return { shots: [], before: { ...enemy.pos } };
}

describe('적 봇 — 움직임', () => {
  it('멀리 있으면 플레이어 쪽으로 다가온다', () => {
    const enemy = enemyAt(20, 0);
    run([enemy], 1, MOVE_ONLY);
    expect(enemy.pos.x).toBeLessThan(20);
    expect(Math.abs(enemy.pos.y)).toBeLessThan(0.5);
  });

  it('너무 가까우면 물러난다', () => {
    const enemy = enemyAt(ENEMY.keepDistance - 2, 0);
    const before = enemy.pos.x;
    run([enemy], 0.5, MOVE_ONLY);
    expect(enemy.pos.x).toBeGreaterThan(before);
  });

  it('사이 구간에서는 거리를 지키며 옆으로 돈다', () => {
    const mid = (ENEMY.keepDistance + ENEMY.approachDistance) / 2;
    const enemy = enemyAt(mid, 0);
    run([enemy], 2, MOVE_ONLY);
    // 옆으로 돌았으니 y가 움직였고, 플레이어와의 거리는 두 경계 사이에 남아 있다.
    expect(Math.abs(enemy.pos.y)).toBeGreaterThan(1);
    const dist = Math.hypot(enemy.pos.x, enemy.pos.y);
    expect(dist).toBeGreaterThan(ENEMY.keepDistance - 1);
    expect(dist).toBeLessThan(ENEMY.approachDistance + 1);
  });

  it('겹쳐 서지 않는다 (한 발에 여럿이 맞으면 안 된다)', () => {
    // 같은 자리에서 시작해도 서로 밀어낸다.
    const enemies = [enemyAt(11, 0), enemyAt(11, 0), enemyAt(11.05, 0.05)];
    run(enemies, 3, MOVE_ONLY);
    for (let i = 0; i < enemies.length; i += 1) {
      for (let j = i + 1; j < enemies.length; j += 1) {
        const a = enemies[i]!;
        const b = enemies[j]!;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(ENEMY.radius * 2);
      }
    }
  });

  it('벽을 넘지 않는다', () => {
    // 플레이어가 벽 밖에 있다고 속여도(가장 나쁜 경우) 적은 아레나 안에 남는다.
    const enemy = enemyAt(20, 0);
    run([enemy], 20, { ...MOVE_ONLY, playerPos: { x: 200, y: 0 } });
    expect(Math.hypot(enemy.pos.x, enemy.pos.y)).toBeLessThanOrEqual(ARENA.radius - ENEMY.radius);
  });
});

describe('적 봇 — 겨누고 쏘기', () => {
  it('사거리 안이면 겨눈 뒤에 쏜다 (예고 없이 맞지 않는다)', () => {
    const enemy = enemyAt(10, 0);
    // 겨누기가 끝나기 직전까지는 한 발도 나오지 않는다.
    const early = run([enemy], ENEMY.aimTime - 2 * DT);
    expect(early).toHaveLength(0);
    expect(enemy.aimTimer).toBeGreaterThan(0);

    const later = run([enemy], 0.1);
    expect(later).toHaveLength(1);
    expect(enemy.aimTimer).toBe(0);
  });

  it('겨누는 동안에는 멈춰 선다 (그 멈춤이 유일한 예고다)', () => {
    const enemy = enemyAt(10, 0);
    run([enemy], DT * 2);
    expect(enemy.aimTimer).toBeGreaterThan(0);
    const frozen = { ...enemy.pos };
    run([enemy], ENEMY.aimTime - 4 * DT);
    expect(enemy.pos.x).toBeCloseTo(frozen.x, 9);
    expect(enemy.pos.y).toBeCloseTo(frozen.y, 9);
  });

  it('사거리 밖이면 쏘지 않는다', () => {
    const enemy = enemyAt(ENEMY.fireRange + 6, 0);
    // 다가오는 동안에는 한 발도 나오지 않는다(사거리 안에 들기 전까지).
    const shots = run([enemy], (6 / ENEMY.speed) * 0.8);
    expect(shots).toHaveLength(0);
  });

  it('쓰러진 플레이어는 쏘지 않는다', () => {
    const enemy = enemyAt(10, 0);
    expect(run([enemy], 4, { playerAlive: false })).toHaveLength(0);
  });

  it('발사 간격을 지킨다', () => {
    const enemy = enemyAt(10, 0);
    const seconds = 12;
    const shots = run([enemy], seconds);
    // 한 발마다 겨누는 시간 + 쉬는 시간이 든다.
    expect(shots.length).toBeLessThanOrEqual(
      Math.ceil(seconds / (ENEMY.aimTime + ENEMY.fireCooldown)) + 1,
    );
    expect(shots.length).toBeGreaterThan(1);
  });

  it('화살은 몸 앞에서 플레이어 쪽으로 나간다', () => {
    const enemy = enemyAt(10, 0);
    const { shots, before } = runUntilShot(enemy, 4);
    const shot = shots[0]!;
    // -x 방향(플레이어 쪽)으로 나가고, 시작점은 몸통 앞이다.
    expect(shot.dir.x).toBeLessThan(-0.9);
    expect(Math.hypot(shot.pos.x - before.x, shot.pos.y - before.y)).toBeCloseTo(
      ENEMY.arrow.muzzleOffset,
      6,
    );
  });
});

/**
 * DESIGN 9번 첫 종류 — 돌진형.
 *
 * 활잡이와 같은 문법(예고 → 저지름 → 물러남)을 쓰되 저지르는 것이 다르다.
 * 여기서 지키는 것은 셋이다:
 * 1. **화살을 쏘지 않는다** — 다른 종류가 아니라 같은 적의 다른 색이 되면 안 된다.
 * 2. **예고가 있다** — 웅크리는 동안 멈춰 서고, 그 뒤에야 몸이 날아온다.
 * 3. **직선으로만 간다** — 옆으로 비킨 사람을 따라 꺾지 않는다. 이것이 피할 여지다.
 */
describe('돌진형', () => {
  /** 웅크림이 끝나고 막 튀어나가는 순간까지 돌린다. */
  function runUntilDash(enemy: Enemy, overrides: Partial<EnemyStepOptions> = {}): number {
    for (let i = 0; i < Math.round(20 / DT); i += 1) {
      stepEnemies([enemy], options(overrides));
      if (enemy.dashTimer > 0) return i * DT;
    }
    return -1;
  }

  it('화살을 쏘지 않는다 (몸이 무기다)', () => {
    const enemy = chargerAt(6, 0);
    expect(run([enemy], 10)).toHaveLength(0);
  });

  it('물러나지도 옆으로 돌지도 않고 곧장 다가온다', () => {
    // 활잡이라면 물러날 거리(keepDistance 안쪽)에 세워 둔다.
    // 숨 고르는 중으로 두어 웅크리지 않게 한다 — 웅크리면 멈춰 서므로
    // 무엇을 보고 있는지 흐려진다(돌진을 막 끝낸 적이 실제로 이 상태다).
    const enemy = chargerAt(ENEMY.keepDistance - 2, 0);
    enemy.fireCooldown = 1;
    const before = enemy.pos.x;
    run([enemy], 0.5);
    expect(enemy.pos.x).toBeLessThan(before - 0.5);
    expect(Math.abs(enemy.pos.y)).toBeLessThan(0.01);
  });

  it('사거리 안에 들면 멈춰 웅크린다 (예고 없이 날아오지 않는다)', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    stepEnemies([enemy], options());
    expect(enemy.aimTimer).toBeGreaterThan(0);
    expect(enemy.dashTimer).toBe(0);

    // 웅크리는 동안에는 발이 멎는다.
    const frozen = { ...enemy.pos };
    for (let i = 0; i < Math.round((CHARGER.windup - 2 * DT) / DT); i += 1) {
      stepEnemies([enemy], options());
    }
    expect(enemy.pos.x).toBeCloseTo(frozen.x, 9);
    expect(enemy.dashTimer).toBe(0);
  });

  it('웅크림이 끝나면 추격보다 훨씬 빠르게 튀어나간다', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    expect(runUntilDash(enemy)).toBeGreaterThanOrEqual(0);

    const before = { ...enemy.pos };
    stepEnemies([enemy], options());
    const moved = Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y);
    expect(moved).toBeCloseTo(CHARGER.dashSpeed * DT, 5);
    expect(moved).toBeGreaterThan(CHARGER.speed * DT * 2);
  });

  it('돌진 중에는 방향을 바꾸지 않는다 (옆으로 비키면 빗나간다)', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    runUntilDash(enemy);
    const facing = enemy.facing;
    // 돌진이 시작된 뒤 플레이어가 옆으로 크게 움직여도 따라 꺾지 않는다.
    const dodging = { playerPos: { x: 0, y: 12 } };
    const contacts = runContacts([enemy], CHARGER.dashTime, dodging);
    expect(enemy.facing).toBeCloseTo(facing, 9);
    expect(contacts).toHaveLength(0);
    // 지나간 자리는 원래 겨누던 직선 위다(y는 그대로 0에 가깝다).
    expect(Math.abs(enemy.pos.y)).toBeLessThan(0.01);
  });

  it('굳어 있으면 몸에 닿아 아프다', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    const contacts = runContacts([enemy], CHARGER.windup + CHARGER.dashTime + 0.2);
    expect(contacts).toEqual([CHARGER.damage]);
  });

  it('한 번의 돌진은 한 번만 아프다 (몸을 뚫고 지나가며 두 번 때리지 않는다)', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    // 두 번째 돌진이 시작되기 전까지 돌린다.
    const contacts = runContacts([enemy], CHARGER.windup + CHARGER.dashTime + CHARGER.dashCooldown);
    expect(contacts).toHaveLength(1);
    expect(enemy.dashTimer).toBe(0);
  });

  it('돌진이 끝나면 숨을 고른 뒤에야 다시 웅크린다', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    runUntilDash(enemy);
    // 빗나가게 두고(플레이어를 멀리 옮긴다) 돌진이 끝나기를 기다린다.
    const aside = { playerPos: { x: 0, y: 12 } };
    runContacts([enemy], CHARGER.dashTime + DT, aside);
    expect(enemy.dashTimer).toBe(0);
    expect(enemy.fireCooldown).toBeGreaterThan(0);

    // 쉬는 동안에는 사거리 안이어도 웅크리지 않는다.
    for (let i = 0; i < Math.round((CHARGER.dashCooldown - 0.1) / DT); i += 1) {
      stepEnemies([enemy], options());
    }
    expect(enemy.aimTimer).toBe(0);
    expect(runUntilDash(enemy)).toBeGreaterThanOrEqual(0);
  });

  it('쓰러진 플레이어에게는 돌진하지 않는다', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    for (let i = 0; i < Math.round(6 / DT); i += 1) {
      stepEnemies([enemy], options({ playerAlive: false }));
    }
    expect(enemy.aimTimer).toBe(0);
    expect(enemy.dashTimer).toBe(0);
  });

  it('돌진 중에 쓰러지면 그 돌진도 끝난다 (되살아나 예고 없이 튀어나가지 않는다)', () => {
    const enemy = chargerAt(CHARGER.triggerRange - 0.5, 0);
    runUntilDash(enemy);
    expect(enemy.dashTimer).toBeGreaterThan(0);

    enemy.alive = false;
    enemy.hp = 0;
    enemy.respawnTimer = ENEMY.respawnDelay;
    for (let i = 0; i < Math.round((ENEMY.respawnDelay + 0.1) / DT) && !enemy.alive; i += 1) {
      stepEnemies([enemy], options());
    }
    expect(enemy.alive).toBe(true);
    expect(enemy.dashTimer).toBe(0);
    expect(enemy.hp).toBe(CHARGER.maxHp);
  });

  it('벽을 넘지 않는다 (돌진 중에도)', () => {
    // 벽을 등지고 밖을 향해 돌진하게 만든다 — 가장 나쁜 경우다.
    const enemy = chargerAt(ARENA.radius - 2, 0);
    for (let i = 0; i < Math.round(20 / DT); i += 1) {
      stepEnemies([enemy], options({ playerPos: { x: 200, y: 0 } }));
      expect(Math.hypot(enemy.pos.x, enemy.pos.y)).toBeLessThanOrEqual(ARENA.radius - ENEMY.radius);
    }
  });
});

describe('적 봇 — 쓰러진 뒤', () => {
  it('제자리에 체력을 채워 다시 선다', () => {
    const enemy = enemyAt(12, 3);
    enemy.alive = false;
    enemy.hp = 0;
    enemy.respawnTimer = ENEMY.respawnDelay;
    enemy.pos = { x: 0.5, y: 0.5 };

    run([enemy], ENEMY.respawnDelay - 0.2, MOVE_ONLY);
    expect(enemy.alive).toBe(false);

    // 다시 서는 그 스텝에서 바로 확인한다. 더 돌리면 이미 걸어 나간 뒤다.
    for (let i = 0; i < 60 && !enemy.alive; i += 1) stepEnemies([enemy], options(MOVE_ONLY));
    expect(enemy.alive).toBe(true);
    expect(enemy.hp).toBe(ENEMY.maxHp);
    expect(enemy.pos).toEqual(enemy.home);
  });

  it('쓰러져 있는 동안에는 쏘지 않는다', () => {
    const enemy = enemyAt(10, 0);
    enemy.alive = false;
    enemy.respawnTimer = 100;
    expect(run([enemy], 5)).toHaveLength(0);
  });
});
