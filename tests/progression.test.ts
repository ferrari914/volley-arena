import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import type { FrameInput } from '../src/core/World';
import { ARENA, CORE, LEVEL, PLAYER } from '../src/data/config';
import { createXpCore, type XpCore } from '../src/entities/types';
import {
  createDropCores,
  createProgress,
  gainXp,
  pickAmbientSpawn,
  stepCores,
  xpForLevel,
  xpRatio,
} from '../src/systems/experience';

const DT = 1 / 60;
const curve = LEVEL;

const coreAt = (x: number, y: number, value = 1, ttl = 10): XpCore =>
  createXpCore(1, { x, y }, value, 'ambient', ttl);

const stepOptions = {
  dt: DT,
  playerPos: { x: 0, y: 0 },
  pickupRadius: PLAYER.radius + CORE.radius,
  magnetRadius: CORE.magnetRadius,
  magnetSpeed: CORE.magnetSpeed,
};

/** 씨앗 고정 난수. 테스트도 바퀴마다 같은 장면을 봐야 한다. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('레벨 곡선', () => {
  it('레벨이 오를수록 더 많이 필요하다', () => {
    expect(xpForLevel(2, curve)).toBeGreaterThan(xpForLevel(1, curve));
    expect(xpForLevel(9, curve)).toBeGreaterThan(xpForLevel(8, curve));
  });

  it('한 번에 큰 덩어리를 먹으면 여러 레벨이 함께 오른다', () => {
    const progress = createProgress(curve);
    const gained = gainXp(progress, xpForLevel(1, curve) + xpForLevel(2, curve) + 1, curve);
    expect(gained).toBe(2);
    expect(progress.level).toBe(3);
    expect(progress.xp).toBe(1);
  });

  it('남은 경험치는 버려지지 않는다', () => {
    const progress = createProgress(curve);
    gainXp(progress, 7, curve);
    gainXp(progress, 5, curve);
    expect(progress.totalXp).toBe(12);
    expect(progress.xp).toBe(12);
  });

  it('최대 레벨에서 멈추고 바는 가득 찬 채로 남는다', () => {
    const progress = createProgress(curve);
    gainXp(progress, 1e12, curve);
    expect(progress.level).toBe(curve.max);
    expect(xpRatio(progress)).toBe(1);
    // 더 먹어도 레벨이 오르지 않는다(무한 루프에 빠지지도 않는다).
    expect(gainXp(progress, 1e6, curve)).toBe(0);
  });
});

describe('stepCores', () => {
  it('자석 반경 안이면 플레이어 쪽으로 다가온다', () => {
    const core = coreAt(3, 0);
    stepCores([core], stepOptions);
    expect(core.pos.x).toBeLessThan(3);
    expect(core.alive).toBe(true);
  });

  it('자석 반경 밖이면 가만히 있고 수명이 줄어든다', () => {
    const core = coreAt(CORE.magnetRadius + 2, 0, 1, 10);
    stepCores([core], stepOptions);
    expect(core.pos.x).toBe(CORE.magnetRadius + 2);
    expect(core.ttl).toBeLessThan(10);
  });

  it('끌려오는 중에는 수명이 줄지 않는다 (손에 닿기 직전에 증발하면 안 된다)', () => {
    const core = coreAt(2, 0, 1, 0.1);
    stepCores([core], stepOptions);
    expect(core.ttl).toBe(0.1);
    expect(core.alive).toBe(true);
  });

  it('몸에 닿으면 사라지고 출처별로 경험치가 잡힌다', () => {
    const ambient = createXpCore(1, { x: 0.2, y: 0 }, 1, 'ambient', 10);
    const drop = createXpCore(2, { x: 0, y: 0.2 }, 5, 'drop', 10);
    const gained = stepCores([ambient, drop], stepOptions);
    expect(gained).toEqual({ ambient: 1, drop: 5 });
    expect(ambient.alive).toBe(false);
    expect(drop.alive).toBe(false);
  });

  it('자석 반경 안에 들어오면 결국 주워진다', () => {
    const core = coreAt(CORE.magnetRadius - 0.1, 0);
    let total = 0;
    for (let i = 0; i < 120; i += 1) total += stepCores([core], stepOptions).ambient;
    expect(total).toBe(1);
  });
});

describe('코어가 생기는 자리', () => {
  const spawnOptions = {
    arenaRadius: ARENA.radius,
    edgeMargin: CORE.ambient.edgeMargin,
    minPlayerDistance: CORE.ambient.minPlayerDistance,
  };

  it('아레나 안쪽에 생기고 플레이어 발밑을 피한다', () => {
    const random = makeRandom(7);
    const player = { x: 4, y: -3 };
    for (let i = 0; i < 200; i += 1) {
      const pos = pickAmbientSpawn(random, player, spawnOptions);
      expect(Math.hypot(pos.x, pos.y)).toBeLessThanOrEqual(ARENA.radius - CORE.ambient.edgeMargin);
      expect(Math.hypot(pos.x - player.x, pos.y - player.y)).toBeGreaterThanOrEqual(
        CORE.ambient.minPlayerDistance,
      );
    }
  });

  it('드롭은 쓰러진 자리 근처에, 벽 안쪽에 떨어진다', () => {
    const random = makeRandom(11);
    let id = 0;
    const at = { x: ARENA.radius - 0.4, y: 0 };
    const cores = createDropCores(at, () => (id += 1), random, {
      count: CORE.drop.perKill,
      value: CORE.drop.value,
      lifetime: CORE.drop.lifetime,
      scatter: CORE.drop.scatter,
      limitRadius: ARENA.radius - 0.6,
    });
    expect(cores).toHaveLength(CORE.drop.perKill);
    for (const core of cores) {
      expect(core.value).toBe(CORE.drop.value);
      expect(core.origin).toBe('drop');
      expect(Math.hypot(core.pos.x, core.pos.y)).toBeLessThanOrEqual(ARENA.radius - 0.6 + 1e-9);
      expect(Math.hypot(core.pos.x - at.x, core.pos.y - at.y)).toBeLessThanOrEqual(
        CORE.drop.scatter + 1e-9,
      );
    }
  });
});

/** 가장 가까운 코어로 걸어가는 사람. 실제로 하는 사람이 하는 행동이다. */
function walkToNearestCore(world: World): FrameInput {
  let best: XpCore | null = null;
  let bestDist = Infinity;
  for (const core of world.cores) {
    if (!core.alive) continue;
    const d = Math.hypot(core.pos.x - world.player.pos.x, core.pos.y - world.player.pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = core;
    }
  }
  if (!best || bestDist < 1e-6) return { move: { x: 0, y: 0 }, aim: null };
  return {
    move: {
      x: (best.pos.x - world.player.pos.x) / bestDist,
      y: (best.pos.y - world.player.pos.y) / bestDist,
    },
    aim: null,
  };
}

describe('World — 경험치 코어', () => {
  it('시작하자마자 맵에 코어가 깔려 있다', () => {
    const world = new World();
    expect(world.cores.filter((c) => c.origin === 'ambient')).toHaveLength(CORE.ambient.initial);
  });

  it('대상을 맞히면 그 자리에 코어가 떨어진다', () => {
    const world = new World();
    for (let i = 0; i < 300 && world.hits === 0; i += 1) {
      world.step({ move: { x: 0, y: 0 }, aim: null }, DT);
    }
    expect(world.hits).toBeGreaterThan(0);
    expect(world.cores.filter((c) => c.origin === 'drop').length).toBeGreaterThanOrEqual(
      CORE.drop.perKill,
    );
  });

  it('코어를 주우면 레벨이 오른다', () => {
    const world = new World();
    for (let i = 0; i < 60 * 30; i += 1) world.step(walkToNearestCore(world), DT);
    expect(world.progress.totalXp).toBeGreaterThan(0);
    expect(world.progress.level).toBeGreaterThan(1);
    expect(world.levelUps).toBeGreaterThanOrEqual(0);
  });

  it('맵에 저절로 생기는 코어는 정해진 수를 넘지 않는다', () => {
    // 가만히 서 있으면 앰비언트 코어는 최소 거리 밖에 생겨 저절로 줍히지 않는다.
    const world = new World();
    for (let i = 0; i < 60 * 120; i += 1) world.step({ move: { x: 0, y: 0 }, aim: null }, DT);
    const ambient = world.cores.filter((c) => c.origin === 'ambient').length;
    expect(ambient).toBeLessThanOrEqual(CORE.ambient.max);
    expect(ambient).toBe(CORE.ambient.max);
  });

  it('난전에서도 코어가 무한정 쌓이지 않는다', () => {
    // 코어를 줍지 않고 계속 쏘기만 하는 최악의 경우.
    const world = new World();
    for (let i = 0; i < 60 * 120; i += 1) world.step({ move: { x: 0, y: 0 }, aim: null }, DT);
    expect(world.cores.length).toBeLessThanOrEqual(CORE.maxAlive);
  });
});

/**
 * DESIGN 3번: "적을 잡는 쪽이 확실히 빠르게 성장하도록 비율을 잡는다.
 * 코어만 주우며 전투를 피하는 것이 최적해가 되면 안 된다."
 *
 * 이걸 수치로 못 박아 둔다. 밸런스를 만지다 이 검사가 깨지면
 * 기획을 어긴 것이다 — 검사를 고치지 말고 수치를 되돌려야 한다.
 */
describe('밸런스 — 전투가 채집보다 빠르다', () => {
  /**
   * 전투를 피하는 사람의 수입 상한(XP/s).
   * 맵 코어는 `spawnInterval`마다 하나씩만 생기므로, 아무리 빨리 뛰어다녀도
   * 장기적으로는 이 속도 이상 벌 수 없다. 상한이라 실측보다 강한 주장이다.
   */
  const ambientCeiling = CORE.ambient.value / CORE.ambient.spawnInterval;

  it('전투 수입이 채집 수입 상한의 3배를 넘는다', () => {
    const seconds = 60;
    const world = new World();
    for (let i = 0; i < 60 * seconds; i += 1) world.step(walkToNearestCore(world), DT);

    const dropRate = world.xpByOrigin.drop / seconds;
    // 눈으로도 볼 수 있게 남긴다. 밸런스를 만질 때 이 수치를 보고 판단한다.
    console.log(
      `전투 ${dropRate.toFixed(2)} XP/s · 채집 상한 ${ambientCeiling.toFixed(2)} XP/s ` +
        `(${(dropRate / ambientCeiling).toFixed(1)}배) · 60초에 ${world.hits}처치 ` +
        `Lv${world.progress.level}`,
    );
    expect(dropRate).toBeGreaterThan(ambientCeiling * 3);
  });

  it('한 판(3~5분) 안에 레벨이 충분히 오른다', () => {
    const world = new World();
    for (let i = 0; i < 60 * 240; i += 1) world.step(walkToNearestCore(world), DT);
    // 4번(3중 1택)에서 레벨업 한 번이 카드 한 장이 된다. 4분에 10장 밑이면 심심하다.
    expect(world.progress.level).toBeGreaterThanOrEqual(10);
  });
});
