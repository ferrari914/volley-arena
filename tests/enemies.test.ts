import { describe, expect, it } from 'vitest';
import {
  ARENA,
  ARROW,
  BOMBER,
  CHARGER,
  CORE,
  ENEMY,
  LOBBER,
  LOOTER,
  PLAYER,
  SHIELD,
  VIEW,
} from '../src/data/config';
import { createEnemy, createXpCore, type Enemy, type Obstacle, type XpCore } from '../src/entities/types';
import { stepEnemies, type EnemyStepOptions } from '../src/systems/enemyAi';
import { sightBlocker } from '../src/systems/obstacles';

const DT = 1 / 60;

let nextId = 1;
const enemyAt = (x: number, y: number): Enemy => createEnemy(nextId++, x, y, ENEMY.maxHp);
/** 돌진형 한 마리(DESIGN 9번). 활잡이와 같은 자리에 세워 두고 행동만 비교한다. */
const chargerAt = (x: number, y: number): Enemy =>
  createEnemy(nextId++, x, y, CHARGER.maxHp, 'charger');
/** 방패병 한 마리(DESIGN 9번). 방패를 들려서 세운다. */
const shieldAt = (x: number, y: number): Enemy =>
  createEnemy(nextId++, x, y, SHIELD.maxHp, 'shield', SHIELD.shieldHp);

/** 약탈꾼에게 건네는 수치(DESIGN 9번). World가 만드는 것과 같은 자리다. */
const LOOTER_OPTIONS = { ...LOOTER, reach: ENEMY.radius + CORE.radius };

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
    obstacles: [],
    arrowRadius: ARROW.radius,
    separation: ENEMY.separation,
    aimTime: ENEMY.aimTime,
    fireCooldown: ENEMY.fireCooldown,
    spread: ENEMY.spread,
    muzzleOffset: ENEMY.arrow.muzzleOffset,
    contactRadius: ENEMY.radius + PLAYER.radius,
    charger: CHARGER,
    shield: SHIELD,
    bomber: BOMBER,
    looter: LOOTER_OPTIONS,
    lobber: LOBBER,
    cores: [],
    view: VIEW,
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
 * 돌진형의 움직임만 보고 싶을 때. 사거리를 0으로 두면 웅크리지 않으므로
 * 멈춰 서지도, 숨 고르기에 들어가지도 않는다 — `MOVE_ONLY`와 같은 이유다.
 */
const NEVER_DASHES: Partial<EnemyStepOptions> = { charger: { ...CHARGER, triggerRange: 0 } };

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
    // 활잡이라면 물러날 거리(keepDistance 안쪽)에 세워 둔다. 웅크리지 않게
    // 사거리를 지워 둔다 — 웅크리면 멈춰 서므로 무엇을 보고 있는지 흐려진다.
    const enemy = chargerAt(ENEMY.keepDistance - 2, 0);
    const before = enemy.pos.x;
    run([enemy], 0.5, NEVER_DASHES);
    expect(enemy.pos.x).toBeLessThan(before - 0.5);
    expect(Math.abs(enemy.pos.y)).toBeLessThan(0.01);
  });

  it('숨 고르는 동안 몸에 붙어 있으면 물러난다 (플레이어를 가리고 서지 않는다)', () => {
    // 돌진이 막 끝나 플레이어에게 겹쳐 선 자리다. 이 상태로 두면 화면에서
    // 플레이어가 적의 몸에 가려 보이지 않는다(스크린샷에서 잡은 고장이다).
    const enemy = chargerAt(1, 0);
    enemy.fireCooldown = CHARGER.dashCooldown;
    run([enemy], 1.5);
    expect(enemy.pos.x).toBeGreaterThan(CHARGER.backoff - 0.2);
  });

  it('물러난 뒤에는 그 선 위에서 떨지 않고 서서 기다린다', () => {
    const enemy = chargerAt(1, 0);
    enemy.fireCooldown = 10; // 숨 고르기가 끝나 웅크리기 시작하지 않도록 길게 둔다.
    run([enemy], 1.5);

    // **한 프레임씩** 잰다. 오간 거리는 서로 지워지므로 처음과 끝의 자리만 비교하면
    // 떨고 있어도 제자리로 보인다 — 경계가 하나뿐인 판이 실제로 이 검사를 통과했다.
    let worst = 0;
    for (let i = 0; i < Math.round(0.5 / DT); i += 1) {
      const before = { ...enemy.pos };
      stepEnemies([enemy], options());
      worst = Math.max(worst, Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y));
    }
    // 경계가 하나면 여기서 한 발짝(speed * dt)씩 앞뒤로 오간다.
    expect(worst).toBeLessThan(CHARGER.speed * DT * 0.01);
  });

  it('숨 고르는 동안 사거리 밖으로 달아나면 다시 따라붙는다', () => {
    const enemy = chargerAt(CHARGER.triggerRange + 4, 0);
    enemy.fireCooldown = 10;
    const before = enemy.pos.x;
    run([enemy], 0.5);
    expect(enemy.pos.x).toBeLessThan(before - 0.5);
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
    expect(enemy.pos).toEqual(enemy.standAt);
  });

  it('쓰러져 있는 동안에는 쏘지 않는다', () => {
    const enemy = enemyAt(10, 0);
    enemy.alive = false;
    enemy.respawnTimer = 100;
    expect(run([enemy], 5)).toHaveLength(0);
  });
});

/**
 * DESIGN 9번 둘째 종류 — 방패병.
 *
 * 앞의 둘과 같은 문법(다가온다 · 예고한다 · 저지른다)을 쓰고, 저지르는 것도
 * 활잡이와 같은 화살이다. **이 적이 새로 요구하는 것은 서는 자리다** — 돌아서 쏴라.
 * 그 요구가 성립하려면 여기 있는 것들이 지켜져야 한다:
 * 1. **느리게 돈다** — 붙어서 도는 사람을 못 따라와야 옆구리가 열린다.
 * 2. **옆으로 돌지 않는다** — 둘이 함께 돌면 각이 그대로여서 영영 안 열린다.
 * 3. **가까이 온다** — 돌아갈 수 있는 거리까지 걸어와야 한다.
 * (방패가 실제로 막는 자리는 화살 쪽 일이라 `tests/systems.test.ts`가 본다.)
 */
describe('방패병', () => {
  /** 겨누지 않게 해 두고 움직임만 본다. `MOVE_ONLY`와 같은 이유다. */
  const NEVER_AIMS: Partial<EnemyStepOptions> = { shield: { ...SHIELD, fireRange: 0 } };
  /** 도는 것만 본다. 발을 묶어 두어야 반지름이 변하지 않는다. */
  const TURN_ONLY: Partial<EnemyStepOptions> = {
    shield: { ...SHIELD, fireRange: 0, speed: 0 },
  };

  /**
   * 플레이어가 반지름 radius로 적 주위를 도는 동안 돌린다.
   * 돌기가 끝난 뒤 적이 보는 쪽과 실제 플레이어 방향 사이의 각(rad)을 돌려준다 —
   * 이 각이 방패의 반각(`SHIELD.arc`)을 넘으면 옆구리가 열린 것이다.
   */
  function orbit(enemy: Enemy, radius: number, seconds: number): number {
    let angle = 0;
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      angle += (PLAYER.speed / radius) * DT;
      const playerPos = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      stepEnemies([enemy], options({ ...TURN_ONLY, playerPos }));
    }
    const last = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    const toPlayer = Math.atan2(last.y - enemy.pos.y, last.x - enemy.pos.x);
    return Math.abs(Math.atan2(Math.sin(toPlayer - enemy.facing), Math.cos(toPlayer - enemy.facing)));
  }

  it('활잡이처럼 겨눈 뒤에 쏜다 (예고는 종류를 가리지 않는다)', () => {
    const enemy = shieldAt(0, -8);
    const shots = run([enemy], SHIELD.aimTime + 0.2);
    expect(shots.length).toBe(1);
  });

  it('활잡이보다 가까이 와서야 겨눈다 (돌아갈 수 있는 거리까지 걸어온다)', () => {
    // 활잡이가 쏘는 거리(15 안쪽)에 세워 둔다. 방패병은 아직 쏘지 못한다.
    const between = (ENEMY.fireRange + SHIELD.fireRange) / 2;
    expect(run([shieldAt(0, -between)], 1, { shield: { ...SHIELD, speed: 0 } })).toHaveLength(0);
    expect(run([enemyAt(0, -between)], 1, { speed: 0 }).length).toBeGreaterThan(0);
  });

  it('붙어서 도는 사람은 못 따라온다 (옆구리가 열린다)', () => {
    const near = shieldAt(0, -6);
    // 6m에서 도는 사람의 각속도는 1.2rad/s, 방패병은 0.8rad/s다. 초당 0.4rad씩 벌어진다.
    expect(orbit(near, 6, 4)).toBeGreaterThan(SHIELD.arc);
  });

  it('멀찍이 도는 사람은 방패가 따라 돈다 (붙어야 열린다)', () => {
    const far = shieldAt(0, -12);
    // 12m에서 도는 사람의 각속도는 0.6rad/s로 방패병(0.8)보다 느리다 — 계속 정면이다.
    expect(orbit(far, 12, 4)).toBeLessThan(SHIELD.arc);
  });

  it('사이 구간에서는 옆으로 돌지 않고 버티고 선다', () => {
    const middle = (SHIELD.keepDistance + SHIELD.approachDistance) / 2;
    const enemy = shieldAt(0, -middle);
    const before = { ...enemy.pos };
    run([enemy], 1, NEVER_AIMS);
    expect(Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y)).toBeLessThan(0.05);
  });

  it('멀면 다가오고 너무 가까우면 물러난다', () => {
    const far = shieldAt(0, -14);
    run([far], 1, NEVER_AIMS);
    expect(Math.hypot(far.pos.x, far.pos.y)).toBeLessThan(14);

    const close = shieldAt(0, -SHIELD.keepDistance + 2);
    run([close], 1, NEVER_AIMS);
    expect(Math.hypot(close.pos.x, close.pos.y)).toBeGreaterThan(SHIELD.keepDistance - 2);
  });

  it('두 경계 사이에 멈춰 서고 그 선 위에서 떨지 않는다', () => {
    // 세션 13이 돌진형에서 밟은 자리다 — 경계가 하나면 그 선 위에서 앞뒤로 떤다.
    const enemy = shieldAt(0, -14);
    run([enemy], 6, NEVER_AIMS);
    const settled = Math.hypot(enemy.pos.x, enemy.pos.y);
    expect(settled).toBeGreaterThanOrEqual(SHIELD.keepDistance);
    expect(settled).toBeLessThanOrEqual(SHIELD.approachDistance + 0.1);

    let moved = 0;
    for (let i = 0; i < Math.round(2 / DT); i += 1) {
      const before = { ...enemy.pos };
      stepEnemies([enemy], options(NEVER_AIMS));
      moved = Math.max(moved, Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y));
    }
    expect(moved).toBeLessThan(0.01);
  });

  it('겨누는 동안에는 멈춰 선다 (활잡이와 같은 예고다)', () => {
    const enemy = shieldAt(0, -14);
    // 걸어와 사거리에 드는 순간까지만 돌린다. 시간을 정해 두고 재면 그 사이에
    // 겨눔이 끝나 버려 무엇을 보고 있는지 흐려진다.
    for (let i = 0; i < Math.round(10 / DT) && enemy.aimTimer <= 0; i += 1) {
      stepEnemies([enemy], options());
    }
    expect(enemy.aimTimer).toBeGreaterThan(0);
    const before = { ...enemy.pos };
    run([enemy], SHIELD.aimTime / 2);
    expect(Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y)).toBeLessThan(1e-6);
  });

  it('다시 서면 방패도 돌아온다 (한 번 쓰고 사라지지 않는다)', () => {
    const enemy = shieldAt(0, -8);
    enemy.shieldHp = 0;
    enemy.alive = false;
    enemy.respawnTimer = ENEMY.respawnDelay;
    run([enemy], ENEMY.respawnDelay + 0.1, NEVER_AIMS);
    expect(enemy.alive).toBe(true);
    expect(enemy.shieldHp).toBe(SHIELD.shieldHp);
  });
});

/**
 * **폭탄병** (DESIGN 9번 · 넷째 종류).
 *
 * 여기 있는 것은 **한 프레임의 규칙**이다 — 언제 불을 붙이고, 붙은 불이 무엇을 하는가.
 * 그 원이 누구에게 닿는지(맞히는 원과 그리는 원이 같은가 · 스스로 터진 것은 처치가
 * 아니라는 것)는 World의 일이라 `tests/world.test.ts`가 잰다.
 *
 * **앞의 셋과 갈리는 자리를 골라 잰다.** 같은 것(다가온다 · 예고한다 · 저지른다)은
 * 이미 위에서 재고 있으므로, 여기서는 **폭탄병이 아니면 참이 아닌 것**만 못 박는다:
 * 한 번 붙은 불은 꺼지지 않는다 · 그 자리에서 터진다 · 터지면 제 몸도 눕는다.
 */
describe('폭탄병', () => {
  /** 폭탄병 한 마리(DESIGN 9번). 활잡이와 같은 자리에 세워 두고 행동만 비교한다. */
  const bomberAt = (x: number, y: number): Enemy =>
    createEnemy(nextId++, x, y, BOMBER.maxHp, 'bomber');

  /** seconds초 동안 돌리고 그동안 터진 것을 모아 돌려준다. */
  function runBlasts(enemies: Enemy[], seconds: number, overrides: Partial<EnemyStepOptions> = {}) {
    const blasts = [];
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      blasts.push(...stepEnemies(enemies, options(overrides)).blasts);
    }
    return blasts;
  }

  it('터질 원이 붙어 서는 자리보다 넓다 (옆으로 도는 것으로는 못 벗어난다)', () => {
    // 이 적이 요구하는 것이 이 부등호 하나다 — 같거나 좁으면 불을 붙인 자리에
    // 가만히 서 있어도 아무 일이 없고, 그러면 "물러나라"가 아니라 "무시하라"가 된다.
    expect(BOMBER.blastRadius).toBeGreaterThan(BOMBER.triggerRange + PLAYER.radius);
  });

  it('화살을 쏘지 않는다 (몸이 폭탄이다)', () => {
    const enemy = bomberAt(6, 0);
    expect(run([enemy], 10)).toHaveLength(0);
  });

  it('물러나지도 옆으로 돌지도 않고 곧장 다가온다 (돌진형과 같다)', () => {
    // 활잡이라면 물러날 거리(keepDistance 안쪽)에 세워 둔다.
    const enemy = bomberAt(ENEMY.keepDistance - 2, 0);
    const before = enemy.pos.x;
    run([enemy], 0.4);
    expect(enemy.pos.x).toBeLessThan(before - 0.5);
    expect(Math.abs(enemy.pos.y)).toBeLessThan(0.01);
  });

  it('붙는 거리 밖에서는 불을 붙이지 않는다 (걸어오는 동안은 안전하다)', () => {
    const enemy = bomberAt(BOMBER.triggerRange + 4, 0);
    // 한 발짝만 돌린다 — 더 돌리면 걸어 들어와서 무엇을 보고 있는지 흐려진다.
    expect(runBlasts([enemy], DT)).toHaveLength(0);
    expect(enemy.aimTimer).toBe(0);
  });

  it('붙으면 멈춰 서서 심지를 태운다 (그 멈춤이 유일한 예고다)', () => {
    const enemy = bomberAt(BOMBER.triggerRange - 0.5, 0);
    run([enemy], DT);
    expect(enemy.aimTimer).toBeCloseTo(BOMBER.fuse, 5);

    // 타는 동안에는 발이 멎는다. 예고가 곧 멈춤이라는 규칙은 종류를 가리지 않는다.
    const before = { ...enemy.pos };
    run([enemy], BOMBER.fuse / 2);
    expect(Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y)).toBeLessThan(1e-6);
  });

  it('심지가 다 타면 서 있던 그 자리에서 터지고, 제 몸도 눕는다', () => {
    const enemy = bomberAt(BOMBER.triggerRange - 0.5, 0);
    run([enemy], DT);
    const stood = { ...enemy.pos };

    const blasts = runBlasts([enemy], BOMBER.fuse + DT);
    expect(blasts).toHaveLength(1);
    expect(blasts[0]?.at.x).toBeCloseTo(stood.x, 5);
    expect(blasts[0]?.at.y).toBeCloseTo(stood.y, 5);
    expect(blasts[0]?.radius).toBe(BOMBER.blastRadius);
    // 제 몸이 폭탄이므로 여기서 눕는다. 화살에 쓰러진 적과 같은 자리로 간다.
    expect(enemy.alive).toBe(false);
    // 터진 그 프레임 뒤로 한 프레임이 더 돌아 있으므로 딱 맞추지 않는다.
    expect(enemy.respawnTimer).toBeGreaterThan(ENEMY.respawnDelay - 2 * DT);
  });

  it('한 번 붙은 불은 꺼지지 않는다 — 달아나도 그 자리에서 터진다', () => {
    // **이것이 "물러나라"를 답으로 만드는 규칙이다.** 따라가며 터지면 물러나는 것이
    // 답이 아니게 되고, 그러면 예고를 봐도 할 수 있는 일이 없다.
    const enemy = bomberAt(BOMBER.triggerRange - 0.5, 0);
    run([enemy], DT);
    const lit = { ...enemy.pos };

    // 심지가 타는 동안 플레이어가 원 밖으로 달아난다.
    const far = { x: 0, y: -(BOMBER.blastRadius + 6) };
    const blasts = runBlasts([enemy], BOMBER.fuse + DT, { playerPos: far });
    expect(blasts).toHaveLength(1);
    expect(blasts[0]?.at.x).toBeCloseTo(lit.x, 5);
    expect(blasts[0]?.at.y).toBeCloseTo(lit.y, 5);
    // 그 자리는 달아난 사람에게서 원 밖이다 — 맞고 안 맞고는 World가 가른다.
    expect(Math.hypot(far.x - lit.x, far.y - lit.y)).toBeGreaterThan(BOMBER.blastRadius);
  });

  it('심지가 타는 동안 쓰러뜨리면 터지지 않는다 (쏘는 쪽 답)', () => {
    const enemy = bomberAt(BOMBER.triggerRange - 0.5, 0);
    run([enemy], DT);
    expect(enemy.aimTimer).toBeGreaterThan(0);

    // 화살이 몸을 비웠다(`systems/combat.ts`가 하는 일과 같다).
    enemy.alive = false;
    enemy.hp = 0;
    enemy.aimTimer = 0;
    enemy.respawnTimer = ENEMY.respawnDelay;
    expect(runBlasts([enemy], BOMBER.fuse + 1)).toHaveLength(0);
  });

  it('쓰러진 플레이어 앞에서는 불을 붙이지 않는다', () => {
    const enemy = bomberAt(BOMBER.triggerRange - 0.5, 0);
    expect(runBlasts([enemy], BOMBER.fuse + 1, { playerAlive: false })).toHaveLength(0);
    expect(enemy.aimTimer).toBe(0);
  });

  it('기다리는 동안에는 붙어 선 자리에서 멈춘다 (코앞까지 파고들지 않는다)', () => {
    // 판이 열린 직후(`ENEMY.startDelay`)와 일어선 사람 앞(`REVIVE.enemyDelay`)이 이 상태다.
    const enemy = bomberAt(BOMBER.triggerRange - 0.5, 0);
    enemy.fireCooldown = 5;
    run([enemy], 2);
    expect(enemy.aimTimer).toBe(0);
    // 몸이 플레이어에 겹쳐 서서 비비는 그림이 되면 안 된다.
    expect(Math.hypot(enemy.pos.x, enemy.pos.y)).toBeGreaterThan(BOMBER.triggerRange - 1);
  });

  it('기둥에 가려 있어도, 화면 밖이어도 다가와 터진다 (돌진형과 같다)', () => {
    // 이 적의 예고는 화살이 닿는지와 상관이 없고, 불을 붙이는 자리(3.5m)는 언제나 화면 안이다.
    // 그래서 활잡이·방패병이 보는 두 가지(가림·창)를 이 적은 묻지 않는다.
    const blocked: Obstacle[] = [{ x: 2, y: 0, radius: 1 }];
    const enemy = bomberAt(-(BOMBER.triggerRange - 0.5), 0);
    enemy.pos = { x: 0, y: -(BOMBER.triggerRange - 0.5) }; // 화면 아래쪽(뒤)에 세운다.
    expect(runBlasts([enemy], BOMBER.fuse + DT, { obstacles: blocked })).toHaveLength(1);
  });
});

/**
 * **적은 맞힐 수 없는 곳에 쏘지 않는다** (DESIGN 10번 · 기둥).
 *
 * 세션 47이 찾은 고장이다: 기둥 뒤에 서면 활잡이가 **기둥에 화살을 먹이며 제자리에 서서**,
 * 손을 놓고도 120~134초를 버텼다(트인 자리 40초). DESIGN 5번("가만히 서 있으면 쓰러진다")이
 * 그 자리에서만 세 배로 무뎌지는 셈이다.
 *
 * 여기 있는 검사는 **한 프레임의 규칙**을 못 박는다. 그 규칙이 한 판에서도 통하는지는
 * `tests/maps.test.ts`가 씨앗 스무 판으로 잰다 — 아레나에는 적이 여럿이고 벽이 있어서,
 * 한 마리에게 되는 일이 판에서도 된다는 보장이 없다.
 */
describe('가림 — 적은 맞힐 수 없는 곳에 쏘지 않는다', () => {
  /** 플레이어(한복판)와 적 사이를 막고 선 기둥. */
  const between: Obstacle[] = [{ x: 6, y: 0, radius: 2 }];

  it('기둥에 가려 있으면 겨누지도 쏘지도 않는다', () => {
    // 발을 묶어 둔다(speed 0). 그러지 않으면 옆으로 돌아 나가 시야를 되찾아서,
    // 이 검사가 "쏘지 않는다"가 아니라 "늦게 쏜다"를 재게 된다.
    const enemy = enemyAt(12, 0);
    const shots = run([enemy], 5, { obstacles: between, speed: 0 });
    expect(shots.length, '기둥에 대고 쐈다').toBe(0);
    expect(enemy.aimTimer, '보이지도 않는데 겨누고 있다').toBe(0);
  });

  it('같은 자리라도 기둥이 없으면 쏜다 (자에 이가 있다)', () => {
    const enemy = enemyAt(12, 0);
    expect(run([enemy], 5, { speed: 0 }).length).toBeGreaterThan(0);
  });

  it('가려 있으면 보이는 자리로 걸어가 쏜다', () => {
    const enemy = enemyAt(12, 0);
    const shots = run([enemy], 6, { obstacles: between });
    expect(shots.length, '자리를 옮기지 않아 끝내 쏘지 못했다').toBeGreaterThan(0);
    // **첫 발이 떠난 자리**에서 실제로 보여야 한다 — 걸어 나와 쏜 것이지
    // 기둥에 대고 쏜 것이 아니다. 마지막 자리만 보면 "쏘고 나서 걸어 나온" 것도 통과한다.
    expect(
      sightBlocker(shots[0]?.pos ?? enemy.pos, { x: 0, y: 0 }, ARROW.radius, between),
      '가린 채로 쐈다',
    ).toBe(null);
  });

  it('겨누기 시작한 뒤에 가려지면 그 한 발은 놓는다 (예고는 약속이다)', () => {
    // 겨눔은 "지금 너를 노린다"는 약속이고, 그 0.5초 사이에 기둥 뒤로 몸을 숨긴 사람은
    // 약속을 보고 피한 것이다. 여기서 거둬들이면 예고가 거짓이 되고,
    // 숨어서 피한 것이 피한 것으로 세어지지 않는다.
    const enemy = enemyAt(12, 0);
    for (let i = 0; i < Math.round(10 / DT) && enemy.aimTimer <= 0; i += 1) {
      stepEnemies([enemy], options());
    }
    expect(enemy.aimTimer).toBeGreaterThan(0);
    // 이제 사이에 기둥이 선다(사람이 몸을 숨긴 것과 같다).
    const shots = run([enemy], ENEMY.aimTime + 0.1, { obstacles: between });
    expect(shots.length, '겨누던 화살을 거둬들였다').toBe(1);
  });

  it('방패병도 가려 있으면 버티지 않고 자리를 옮긴다', () => {
    // 이 적은 평소 옆으로 돌지 않고 버티고 선다(위 검사). 그것은 플레이어가 돌아야 할
    // 상대이기 때문인데, 서로가 서로를 못 보는 동안에는 버틸 정면이 아예 없다.
    const enemy = shieldAt(7, 0);
    const before = { ...enemy.pos };
    run([enemy], 3, { obstacles: between });
    expect(Math.hypot(enemy.pos.x - before.x, enemy.pos.y - before.y)).toBeGreaterThan(1);
  });
});

/**
 * **화면 밖 — 적은 아무도 못 보는 예고를 하지 않는다** (세션 50).
 *
 * 기둥에 가린 것과 같은 종류의 일이다(위 `가림`). 다른 것은 막는 쪽이 기둥이 아니라
 * 화면의 끝이라는 것뿐이고, 그래서 자도 기둥이 아니라 `VIEW`다.
 *
 * **쿼터뷰 카메라는 돌지 않으므로 화면의 위아래가 곧 월드의 -y/+y다.**
 * 화면 아래쪽(플레이어 뒤 · +y)이 12.3m로 가장 좁고, 활잡이의 사거리는 15m다 —
 * 그 사이(12.3~15m)가 **화면 밖에서 겨누던 자리**다.
 */
describe('화면 밖 — 적은 아무도 못 보는 예고를 하지 않는다', () => {
  /** 뒤쪽 창(12.3m) 밖이면서 사거리(15m) 안인 자리. 고치기 전에는 여기서 쐈다. */
  const BEHIND = VIEW.back + 1.5;

  it('화면 아래쪽 끝 너머에 서면 겨누지도 쏘지도 않는다', () => {
    // 발을 묶어 둔다(speed 0). 그러지 않으면 걸어 들어와 쏘게 되어,
    // 이 검사가 "쏘지 않는다"가 아니라 "늦게 쏜다"를 재게 된다.
    const enemy = enemyAt(0, BEHIND);
    const shots = run([enemy], 5, { speed: 0 });
    expect(shots.length, '화면 밖에서 쐈다').toBe(0);
    expect(enemy.aimTimer, '아무도 못 보는데 겨누고 있다').toBe(0);
  });

  it('같은 거리라도 옆에 서면 쏜다 (자에 이가 있다)', () => {
    // 거리는 똑같고 방향만 다르다 — 자르는 것이 거리가 아니라 **화면**이라는 뜻이다.
    // (좌우는 화면이 훨씬 넓다. `tests/camera.test.ts`가 그것을 격자로 증명한다.)
    const enemy = enemyAt(BEHIND, 0);
    expect(run([enemy], 5, { speed: 0 }).length).toBeGreaterThan(0);
  });

  it('화면 위쪽 끝 너머도 마찬가지다', () => {
    const enemy = enemyAt(0, -(VIEW.forward + 0.3));
    const shots = run([enemy], 5, { speed: 0 });
    expect(shots.length, '화면 위쪽 밖에서 쐈다').toBe(0);
  });

  it('화면 밖에서는 굳지 않고 걸어 들어와 쏜다', () => {
    // 화면 밖은 언제나 다가오는 거리(approachDistance 12m) 밖이므로, 적은 이미
    // 다가오는 중이다 — 여기에 따로 "화면 안으로 걸어라"를 만들 필요가 없다.
    // 그 관계(VIEW.back > approachDistance)는 `tests/camera.test.ts`가 지킨다.
    const enemy = enemyAt(0, BEHIND);
    // **첫 발이 떠난 그 프레임의 자리**를 본다. 마지막 자리만 보면 "화면 밖에서 쏘고 나서
    // 걸어 들어온" 것도 통과한다(가림 쪽 검사가 같은 이유로 첫 발의 자리를 본다).
    // 겨누는 동안에는 멈춰 서므로 쏘는 자리가 곧 겨누기 시작한 자리다.
    let firedAt: number | null = null;
    for (let i = 0; i < Math.round(6 / DT) && firedAt === null; i += 1) {
      const y = enemy.pos.y;
      if (stepEnemies([enemy], options()).shots.length > 0) firedAt = y;
    }
    expect(firedAt, '끝내 쏘지 못했다 — 화면 밖에서 굳었다').not.toBeNull();
    expect(firedAt ?? 0, '화면 안으로 들어오지 않고 쐈다').toBeLessThanOrEqual(VIEW.back);
  });

  it('겨누기 시작한 뒤에 화면 밖으로 밀려나도 그 한 발은 놓는다 (예고는 약속이다)', () => {
    // 달려서 적을 화면 밖으로 밀어낸 사람은 **예고를 보고 피한 것**이다.
    // 여기서 거둬들이면 예고가 거짓이 되고, 피한 것이 피한 것으로 세어지지 않는다.
    // (기둥 뒤로 숨은 경우와 같은 규칙이다 — 위 `가림`의 마지막 검사.)
    const enemy = enemyAt(0, VIEW.back - 1);
    for (let i = 0; i < Math.round(10 / DT) && enemy.aimTimer <= 0; i += 1) {
      stepEnemies([enemy], options({ speed: 0 }));
    }
    expect(enemy.aimTimer).toBeGreaterThan(0);
    // 플레이어가 앞으로 달아나 적이 화면 아래쪽 밖으로 밀려난 것과 같다.
    const shots = run([enemy], ENEMY.aimTime + 0.1, {
      speed: 0,
      playerPos: { x: 0, y: -(BEHIND - (VIEW.back - 1)) },
    });
    expect(shots.length, '겨누던 화살을 거둬들였다').toBe(1);
  });

  it('방패병도 화면 밖에서는 겨누지 않는다', () => {
    // 방패병의 사거리는 11m라 평소에는 이 창에 닿지 않는다(`tests/camera.test.ts`).
    // 그래도 규칙은 하나여야 한다 — 종류마다 예고의 규칙이 다르면 매번 새로 배워야 한다.
    // 사거리를 활잡이만큼 늘려 세우고 발을 묶는다(방패병은 제 `shield.speed`로 걷는다).
    const enemy = shieldAt(0, BEHIND);
    const shots = run([enemy], 5, { shield: { ...SHIELD, fireRange: 15, speed: 0 } });
    expect(shots.length, '화면 밖에서 쐈다').toBe(0);
    expect(enemy.aimTimer, '아무도 못 보는데 겨누고 있다').toBe(0);
  });
});

/**
 * 약탈꾼 (DESIGN 9번 · 다섯째 종류). 앞의 넷을 재는 검사들이 전부 "무엇으로 때리는가"를
 * 물었다면, 여기서 묻는 것은 **무엇을 가져가는가와 어디로 걷는가**다.
 * 이 적은 플레이어를 한 번도 때리지 않으므로 화살·몸통·폭발을 잴 자리가 없다.
 */
describe('약탈꾼', () => {
  const looterAt = (x: number, y: number): Enemy =>
    createEnemy(nextId++, x, y, LOOTER.maxHp, 'looter');

  let nextCoreId = 1;
  const coreAt = (x: number, y: number): XpCore =>
    createXpCore(nextCoreId++, { x, y }, 1, 'ambient', Infinity);

  /** seconds초 동안 돌리고 그동안 삼켜 간 코어를 모아 돌려준다. */
  function runSteals(
    enemies: Enemy[],
    cores: XpCore[],
    seconds: number,
    overrides: Partial<EnemyStepOptions> = {},
  ) {
    const steals = [];
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      const stolen = stepEnemies(enemies, options({ cores, ...overrides })).steals;
      // World가 하는 일을 여기서도 한다 — `stepEnemies`는 코어를 지우지 않는다.
      for (const steal of stolen) steal.core.alive = false;
      steals.push(...stolen);
    }
    return steals;
  }

  it('화살도 몸통도 폭발도 없다 (이 적은 때리지 않는다)', () => {
    const enemy = looterAt(2, 0);
    const cores = [coreAt(20, 0)];
    let shots = 0;
    let contacts = 0;
    let blasts = 0;
    for (let i = 0; i < Math.round(12 / DT); i += 1) {
      const acted = stepEnemies([enemy], options({ cores }));
      shots += acted.shots.length;
      contacts += acted.contacts.length;
      blasts += acted.blasts.length;
    }
    expect(shots + contacts + blasts).toBe(0);
  });

  it('플레이어가 아니라 코어 쪽으로 걷고, 등을 보인다', () => {
    // 코어는 플레이어 반대편에 둔다. 나머지 넷이라면 곧장 플레이어에게 왔을 자리다.
    const enemy = looterAt(8, 0);
    const cores = [coreAt(20, 0)];
    const before = enemy.pos.x;
    // 태어날 때는 플레이어를 보고 선다(`createEnemy`). 이 적만 그 자리에서 돌아선다 —
    // `LOOTER.turnRate`로 반 바퀴를 도는 데 1초쯤 걸리므로 그보다 길게 돌린다.
    runSteals([enemy], cores, 1.2);
    expect(enemy.pos.x, '플레이어 쪽으로 왔다').toBeGreaterThan(before + 1);
    // 몸이 향하는 쪽이 플레이어의 정반대다 — 화면에서 등이 보인다는 뜻이다.
    expect(Math.abs(enemy.facing), '플레이어를 돌아봤다').toBeLessThan(0.2);
  });

  it('코어에 닿으면 멈춰 서서 삼킨다 (예고 없이 사라지지 않는다)', () => {
    const enemy = looterAt(20, 0);
    const cores = [coreAt(20.5, 0)];
    runSteals([enemy], cores, DT);
    expect(enemy.aimTimer).toBeCloseTo(LOOTER.swallow, 5);

    // 삼키는 동안에는 발이 멎는다. 예고가 곧 멈춤이라는 규칙은 종류를 가리지 않는다.
    const stood = { ...enemy.pos };
    const mid = runSteals([enemy], cores, LOOTER.swallow / 2);
    expect(mid).toHaveLength(0);
    expect(Math.hypot(enemy.pos.x - stood.x, enemy.pos.y - stood.y)).toBeLessThan(1e-6);

    const steals = runSteals([enemy], cores, LOOTER.swallow);
    expect(steals).toHaveLength(1);
    expect(steals[0]?.core).toBe(cores[0]);
    expect(cores[0]?.alive, 'World가 지우기 전까지는 살아 있어야 한다').toBe(false);
  });

  it('삼키는 중에 쓰러뜨리면 코어는 그 자리에 남는다', () => {
    // 폭탄병의 심지와 같은 자리다 — 예고에 값이 있으려면 끼어들 수 있어야 한다.
    const enemy = looterAt(20, 0);
    const cores = [coreAt(20.5, 0)];
    runSteals([enemy], cores, DT);
    expect(enemy.aimTimer).toBeGreaterThan(0);

    enemy.alive = false; // 화살 한 발이 닿았다(`combat.ts`가 하는 일).
    enemy.respawnTimer = ENEMY.respawnDelay;
    const steals = runSteals([enemy], cores, LOOTER.swallow + 1);
    expect(steals).toHaveLength(0);
    expect(cores[0]?.alive).toBe(true);
  });

  it('플레이어 곁의 코어는 건드리지 않는다 (손에 닿기 직전에 증발하지 않는다)', () => {
    const enemy = looterAt(8, 0);
    const cores = [coreAt(LOOTER.guard - 0.5, 0)];
    const steals = runSteals([enemy], cores, 6);
    expect(steals, '발밑의 코어를 집어 갔다').toHaveLength(0);
    expect(cores[0]?.alive).toBe(true);
  });

  it('지키는 선은 끌려오기 시작하는 거리보다 넓다', () => {
    // 이 부등호가 위 검사의 근거다(`CORE.magnetRadius`). 자석이 잡은 코어를
    // 빼앗기면 "끌려오는 중에는 사라지지 않는다"는 코어 쪽의 약속이 깨진다.
    expect(LOOTER.guard).toBeGreaterThan(CORE.magnetRadius);
  });

  it('훔칠 것이 없으면 물러나 서고, 플레이어에게 다가오지 않는다', () => {
    const enemy = looterAt(6, 0);
    runSteals([enemy], [], 4);
    expect(enemy.pos.x).toBeGreaterThanOrEqual(LOOTER.standOff - 0.1);
    // 물러난 뒤에는 그 선 위에서 떨지 않고 선다.
    const settled = { ...enemy.pos };
    runSteals([enemy], [], 2);
    expect(Math.hypot(enemy.pos.x - settled.x, enemy.pos.y - settled.y)).toBeLessThan(0.2);
  });

  it('플레이어보다 느리다 (쫓아가면 잡힌다)', () => {
    // "쫓아가라"가 답이 되려면 이 부등호가 있어야 한다. 빠르면 쫓을 이유가 없어지고,
    // 이 적은 그냥 "가끔 경험치가 사라지는 일"이 된다.
    expect(LOOTER.speed).toBeLessThan(PLAYER.speed);
  });

  it('맵에 놓인 여러 코어 중 제게 가장 가까운 것부터 삼킨다', () => {
    const enemy = looterAt(20, 0);
    const near = coreAt(20, 3);
    const far = coreAt(0, 20);
    const steals = runSteals([enemy], [far, near], 3);
    expect(steals[0]?.core).toBe(near);
  });
});
