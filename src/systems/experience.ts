import { clamp, distanceSq, type Vec2 } from '../core/math';
import { createXpCore, type CoreOrigin, type Progress, type XpCore } from '../entities/types';

/** 레벨 곡선의 모양. 수치는 `data/config.ts`의 LEVEL이 갖고 있다. */
export interface LevelCurve {
  baseXp: number;
  growth: number;
  max: number;
}

/** level에서 level+1로 가는 데 필요한 경험치. 최대 레벨이면 Infinity. */
export function xpForLevel(level: number, curve: LevelCurve): number {
  if (level >= curve.max) return Infinity;
  return Math.round(curve.baseXp * curve.growth ** (level - 1));
}

/**
 * 시작 상태. `entities/types.ts`가 아니라 여기 있는 이유는
 * 첫 레벨의 요구치를 곡선에서 뽑아야 하기 때문이다(타입이 시스템을 알면 순환이 된다).
 */
export function createProgress(curve: LevelCurve): Progress {
  return { level: 1, xp: 0, xpToNext: xpForLevel(1, curve), totalXp: 0 };
}

/**
 * 경험치를 더하고 올라간 레벨 수를 돌려준다.
 * 한 번에 여러 레벨이 오를 수 있다 — 큰 덩어리를 먹었을 때 한 레벨만 올리고
 * 나머지를 버리면 먹은 만큼 강해지지 않는다.
 */
export function gainXp(progress: Progress, amount: number, curve: LevelCurve): number {
  if (amount <= 0) return 0;
  progress.totalXp += amount;
  progress.xp += amount;

  let levelsGained = 0;
  while (progress.xp >= progress.xpToNext) {
    progress.xp -= progress.xpToNext;
    progress.level += 1;
    levelsGained += 1;
    progress.xpToNext = xpForLevel(progress.level, curve);
  }
  // 최대 레벨에서는 xpToNext가 Infinity라 위 반복이 끝난다. 바는 가득 찬 채로 둔다.
  if (!Number.isFinite(progress.xpToNext)) progress.xp = 0;
  return levelsGained;
}

/** 경험치바가 차 있는 비율(0~1). 최대 레벨이면 1. */
export function xpRatio(progress: Progress): number {
  if (!Number.isFinite(progress.xpToNext)) return 1;
  return clamp(progress.xp / progress.xpToNext, 0, 1);
}

export interface CoreStepOptions {
  dt: number;
  playerPos: Vec2;
  /** 이 거리 안이면 줍는다(플레이어 반지름 + 코어 반지름). */
  pickupRadius: number;
  magnetRadius: number;
  magnetSpeed: number;
}

/** 이번 스텝에 주운 경험치를 출처별로 나눠 돌려준다. */
export type CoreStepResult = Record<CoreOrigin, number>;

/**
 * 코어를 한 스텝 처리한다: 끌려오기 → 줍기 → 수명.
 * 죽은 코어는 배열에서 지우지 않고 alive=false 로 두고 호출한 쪽이 정리한다
 * (화살과 같은 규칙. 렌더러가 같은 프레임에 메시를 회수해야 한다).
 */
export function stepCores(cores: XpCore[], options: CoreStepOptions): CoreStepResult {
  const { dt, playerPos, pickupRadius, magnetRadius, magnetSpeed } = options;
  const pickupSq = pickupRadius * pickupRadius;
  const magnetSq = magnetRadius * magnetRadius;
  const gained: CoreStepResult = { ambient: 0, drop: 0 };

  for (const core of cores) {
    if (!core.alive) continue;
    core.age += dt;

    const distSq = distanceSq(core.pos, playerPos);
    if (distSq <= pickupSq) {
      core.alive = false;
      gained[core.origin] += core.value;
      continue;
    }

    if (distSq <= magnetSq) {
      const dist = Math.sqrt(distSq);
      const stepLen = Math.min(magnetSpeed * dt, dist);
      core.pos = {
        x: core.pos.x + ((playerPos.x - core.pos.x) / dist) * stepLen,
        y: core.pos.y + ((playerPos.y - core.pos.y) / dist) * stepLen,
      };
      // 끌려오는 중에는 사라지지 않는다. 손에 닿기 직전에 증발하면 먹은 줄 알았다가 화가 난다.
      continue;
    }

    core.ttl -= dt;
    if (core.ttl <= 0) core.alive = false;
  }

  return gained;
}

export interface AmbientSpawnOptions {
  /** 아레나 반지름. 코어는 이 안쪽에만 생긴다. */
  arenaRadius: number;
  edgeMargin: number;
  minPlayerDistance: number;
}

/**
 * 맵에 저절로 생기는 코어의 자리를 고른다.
 * 플레이어 발밑에 생기면 걷지 않고도 먹으므로 최소 거리를 둔다.
 * 난수는 밖에서 받는다 — World가 씨앗 고정 난수를 쓰므로 장면이 매번 같다.
 */
export function pickAmbientSpawn(
  random: () => number,
  playerPos: Vec2,
  options: AmbientSpawnOptions,
): Vec2 {
  const { arenaRadius, edgeMargin, minPlayerDistance } = options;
  const limit = Math.max(arenaRadius - edgeMargin, 1);
  // 플레이어에서 멀리 떨어진 자리를 몇 번 뽑아 본다. 아레나가 좁아 못 찾을 수도 있으므로
  // 무한히 돌리지 않고, 마지막에 뽑힌 자리를 그냥 쓴다(자리 하나 때문에 프레임을 멈추지 않는다).
  let candidate: Vec2 = { x: 0, y: 0 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const angle = random() * Math.PI * 2;
    // 반지름에 제곱근을 씌워야 원 안에 고르게 퍼진다(안 씌우면 가운데로 몰린다).
    const radius = Math.sqrt(random()) * limit;
    candidate = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    if (distanceSq(candidate, playerPos) >= minPlayerDistance * minPlayerDistance) break;
  }
  return candidate;
}

export interface DropOptions {
  count: number;
  value: number;
  lifetime: number;
  scatter: number;
  /** 코어가 벽 밖으로 튀어나가지 않게 자르는 반지름. */
  limitRadius: number;
}

/**
 * 쓰러진 자리에 코어를 흩뿌린다. 여러 개로 나누는 이유는
 * 한 덩이보다 여러 개가 빨려 들어오는 편이 "잡았다"는 느낌이 훨씬 크기 때문이다.
 */
export function createDropCores(
  at: Vec2,
  nextId: () => number,
  random: () => number,
  options: DropOptions,
): XpCore[] {
  const { count, value, lifetime, scatter, limitRadius } = options;
  const out: XpCore[] = [];
  for (let i = 0; i < count; i += 1) {
    // 고르게 나눠 놓고 조금씩 흔든다. 완전 난수로 두면 세 개가 한자리에 겹치는 판이 나온다.
    const angle = ((i + random() * 0.6) / count) * Math.PI * 2;
    const radius = scatter * (0.55 + random() * 0.45);
    const pos = { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius };
    const dist = Math.hypot(pos.x, pos.y);
    if (dist > limitRadius) {
      pos.x = (pos.x / dist) * limitRadius;
      pos.y = (pos.y / dist) * limitRadius;
    }
    out.push(createXpCore(nextId(), pos, value, 'drop', lifetime));
  }
  return out;
}
