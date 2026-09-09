import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import type { FrameInput } from '../src/core/World';
import { ARENA, CORE, LEVEL, PLAYER } from '../src/data/config';
import { createXpCore, type XpCore } from '../src/entities/types';
import { DT, IDLE, dodgeCharger, median, play, playMatch, walkToNearestCore } from './support/match';
import {
  createDropCores,
  createProgress,
  gainXp,
  pickAmbientSpawn,
  stepCores,
  xpForLevel,
  xpRatio,
} from '../src/systems/experience';

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

/**
 * 체력을 계속 되돌리면서 오래 돌린다. 코어가 쌓이는 상한처럼 "긴 시간"이 필요한 것을
 * 잴 때만 쓴다 — 5번부터는 가만히 서 있으면 30초 만에 쓰러져서, 그냥 돌리면
 * 아레나가 붐비기도 전에 판이 끝난다.
 */
function playUnkillable(world: World, steps: number, input: (w: World) => FrameInput): void {
  for (let i = 0; i < steps; i += 1) {
    world.player.hp = world.player.maxHp;
    const first = world.offer?.choices[0];
    if (first) world.chooseUpgrade(first.card.id);
    world.step(input(world), DT);
  }
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

describe('World — 경험치 코어', () => {
  it('시작하자마자 맵에 코어가 깔려 있다', () => {
    const world = new World();
    expect(world.cores.filter((c) => c.origin === 'ambient')).toHaveLength(CORE.ambient.initial);
  });

  it('적을 쓰러뜨리면 그 자리에 코어가 떨어진다', () => {
    // 멀리 선 활잡이 하나만 세운다. 표준 배치로 재면 발밑까지 오는 돌진형(DESIGN 9번)이
    // 먼저 쓰러지고, 떨어진 코어가 그 자리에서 곧바로 끌려와 주워진다 —
    // 그러면 "떨어졌는가"가 아니라 "주웠는가"를 재게 된다.
    const world = new World({ enemies: [{ x: 12, y: 0 }] });
    let fell = { x: 12, y: 0 };
    for (let i = 0; i < 600 && world.kills === 0; i += 1) {
      const enemy = world.enemies[0];
      if (enemy?.alive) fell = { ...enemy.pos };
      world.step({ move: { x: 0, y: 0 }, aim: null }, DT);
    }
    expect(world.kills).toBeGreaterThan(0);

    const drops = world.cores.filter((c) => c.origin === 'drop');
    expect(drops.length).toBeGreaterThanOrEqual(CORE.drop.perKill);
    // 떨어진 자리는 쓰러진 자리다(플레이어 발밑이 아니다).
    for (const core of drops) {
      expect(Math.hypot(core.pos.x - fell.x, core.pos.y - fell.y)).toBeLessThanOrEqual(
        CORE.drop.scatter + 1e-9,
      );
    }
  });

  it('코어를 주우면 레벨이 오른다', () => {
    const world = new World();
    play(world, 60 * 30, walkToNearestCore);
    expect(world.progress.totalXp).toBeGreaterThan(0);
    expect(world.progress.level).toBeGreaterThan(1);
    // 오른 레벨은 하나도 남김없이 카드 한 장이 됐다(4번).
    expect(world.pendingUpgrades).toBe(0);
    expect(world.takenUpgrades.length).toBe(world.progress.level - 1);
  });

  it('맵에 저절로 생기는 코어는 정해진 수를 넘지 않는다', () => {
    // 가만히 서 있으면 앰비언트 코어는 최소 거리 밖에 생겨 저절로 줍히지 않는다.
    const world = new World();
    playUnkillable(world, 60 * 120, () => IDLE);
    const ambient = world.cores.filter((c) => c.origin === 'ambient').length;
    expect(ambient).toBeLessThanOrEqual(CORE.ambient.max);
    expect(ambient).toBe(CORE.ambient.max);
  });

  it('난전에서도 코어가 무한정 쌓이지 않는다', () => {
    // 코어를 줍지 않고 계속 쏘기만 하는 최악의 경우.
    const world = new World();
    playUnkillable(world, 60 * 120, () => IDLE);
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
   *
   * 4번의 '정제' 카드(경험치 배율)는 두 수입에 똑같이 곱해지므로 이 비교를 흔들지 않는다.
   */
  const ambientCeiling = CORE.ambient.value / CORE.ambient.spawnInterval;

  it('전투 수입이 채집 수입 상한의 3배를 넘는다', () => {
    const seconds = 60;
    const world = new World();
    play(world, 60 * seconds, walkToNearestCore);

    const dropRate = world.xpByOrigin.drop / seconds;
    // 눈으로도 볼 수 있게 남긴다. 밸런스를 만질 때 이 수치를 보고 판단한다.
    console.log(
      `전투 ${dropRate.toFixed(2)} XP/s · 채집 상한 ${ambientCeiling.toFixed(2)} XP/s ` +
        `(${(dropRate / ambientCeiling).toFixed(1)}배) · 60초에 ${world.kills}처치 ` +
        `Lv${world.progress.level}`,
    );
    expect(dropRate).toBeGreaterThan(ambientCeiling * 3);
  });

  it('한 판이 끝나고 오른 레벨이 남김없이 카드가 된다', () => {
    const world = new World();
    // 10분까지 돌려 본다. 그 전에 쓰러지면 거기서 판이 끝난 것이다.
    play(world, 60 * 600, walkToNearestCore);
    console.log(
      `한 판 ${world.elapsed.toFixed(0)}초 · Lv${world.progress.level} · ` +
        `카드 ${world.takenUpgrades.length}장 · ${world.kills}처치 ` +
        `(고른 카드: ${world.takenUpgrades.join(',')})`,
    );

    expect(world.defeated).toBe(true);
    // 레벨업 한 번이 카드 한 장이다(4번). 한 판에 10장 밑이면 심심하다.
    expect(world.progress.level).toBeGreaterThanOrEqual(10);
    expect(world.takenUpgrades.length).toBe(world.progress.level - 1);
    // **"한 판 3~5분"은 여기서 재지 않는다.** 씨앗 하나는 그 선을 증명하지 못한다 —
    // 아래 '한 판 길이' 묶음이 씨앗 20개로 잰다.
  });
});

/**
 * DESIGN 품질 기준의 "한 판이 3~5분 안에 끝날 것".
 *
 * **씨앗 하나로는 이 선을 잴 수 없다.** World의 난수 하나가 코어 자리·드롭·뽑히는 카드를
 * 모두 굴려서, 씨앗이 바뀌면 고른 카드의 순서가 통째로 갈린다. 세션 14가 회복 카드를
 * 넣었을 때 기본 씨앗의 한 판이 253초 → 176초로 "줄어든" 것이 그 증거다 —
 * 회복이 판을 줄일 리 없고, 실제로는 씨앗 20개의 중앙값이 215초 → 228초로 늘었다.
 * 그때까지 검사는 기본 씨앗 하나만 보고 있었고, 그래서 이 선은
 * "늘 지켜지는 선"이 아니라 "그 씨앗에서 지켜지는 선"이었다.
 *
 * 그래서 판을 스무 개 돌려 **중앙값**에 선을 건다. 꼬리는 따로 센다(아래 두 번째 검사).
 * 스무 판을 다 돌려도 0.4초라 `npm test`에 두고 매 바퀴 돌린다 —
 * 세션 14는 "20배 오래 도는 검사"로 보고 `npm run perf` 쪽을 제안했지만, 재 보니 아니었다.
 *
 * **이 선을 벗어나면 밸런스를 되돌릴 것이지, 선을 옮기지 말 것.**
 */
/** DESIGN "3~5분". 코어만 보고 걷는 사람이라 실제 플레이보다 짧게 끝나므로 아래쪽을 넉넉히 잡았다. */
const SHORTEST = 150;
const LONGEST = 330;
/** 씨앗은 고정한다. 바퀴마다 다른 판을 재면 수치를 비교할 수 없다. */
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);
/** 코어만 보고 걷는 사람의 스무 판. 아래 두 묶음이 같은 스무 판을 나눠 본다. */
const results = SEEDS.map((seed) => playMatch(seed));

describe('밸런스 — 한 판 길이 (씨앗 20개)', () => {
  const lengths = results.map((r) => r.elapsed);
  const inRange = lengths.filter((s) => s >= SHORTEST && s <= LONGEST).length;

  it('스무 판의 중앙값이 3~5분 안에 든다', () => {
    const sorted = [...lengths].sort((a, b) => a - b);
    console.log(
      [
        '',
        `  씨앗 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} · ${SEEDS.length}판`,
        `  한 판(초): ${sorted.map((s) => s.toFixed(0)).join(', ')}`,
        `  중앙값 ${median(lengths).toFixed(0)}초 · 가장 짧은 판 ${(sorted[0] ?? 0).toFixed(0)}초 · ` +
          `가장 긴 판 ${(sorted[sorted.length - 1] ?? 0).toFixed(0)}초`,
        `  ${SHORTEST}~${LONGEST}초 안에 든 판: ${inRange}/${SEEDS.length}`,
        `  레벨 중앙값 Lv${median(results.map((r) => r.level)).toFixed(0)} · ` +
          `처치 중앙값 ${median(results.map((r) => r.kills)).toFixed(0)}`,
        '',
      ].join('\n'),
    );

    expect(median(lengths)).toBeGreaterThan(SHORTEST);
    expect(median(lengths)).toBeLessThan(LONGEST);
  });

  it('꼬리가 중앙값을 가리지 않는다 — 스무 판 중 열다섯 이상이 그 안에 든다', () => {
    // 중앙값만 보면 "100초 아니면 500초"인 판도 통과한다. 중앙값이 대표하는 값인지를
    // 여기서 따로 센다. 실측 16/20(세션 15) → 증원을 넣고 17/20(세션 16) —
    // 좁아진 만큼 선을 함께 올린다. 좁아진 것을 검사가 기억하지 않으면 도로 넓어진다.
    expect(inRange).toBeGreaterThanOrEqual(15);
  });

  it('가장 긴 판도 6분을 넘지 않는다', () => {
    // **증원(`REINFORCE`)이 사 온 보장이 이것이다.** 증원이 없던 때는 화력이 세게 자란
    // 씨앗의 판이 391초까지, 카드를 잘 고르는 사람은 514초까지 갔다 — 판 길이가
    // 곧 화력의 함수여서 위쪽에 천장이 없었다. 지금은 시간이 갈수록 아레나가 무거워져
    // 천장이 생긴다(실측 302초 · 잘 고르는 사람 352초).
    // 이 선이 깨지면 증원이 약해진 것이다. 선을 옮기지 말고 `REINFORCE`를 되돌릴 것.
    const longest = Math.max(...lengths);
    expect(longest, `가장 긴 판 ${longest.toFixed(0)}초`).toBeLessThan(360);
  });

  it('어떤 씨앗에서도 판이 10분 안에 끝나고 레벨이 충분히 오른다', () => {
    for (const r of results) {
      // 끝나지 않는 판은 길이를 재는 것 자체가 뜻이 없다(회복 카드가 실제로 낼 뻔한 고장이다).
      expect(r.defeated, `씨앗 ${r.seed}의 판이 끝나지 않았다`).toBe(true);
      expect(r.level, `씨앗 ${r.seed}의 레벨`).toBeGreaterThanOrEqual(10);
      expect(r.cards.length, `씨앗 ${r.seed}의 카드 수`).toBe(r.level - 1);
    }
  });
});

/**
 * DESIGN 9번이 돌진형에게 요구하는 단 하나의 대응: **옆으로 비키면 빗나간다.**
 *
 * 한 프레임짜리 검사는 `tests/enemies.test.ts`에 있다("돌진 중에는 방향을 바꾸지 않는다").
 * 여기서 재는 것은 그것이 **한 판 내내 실제로 통하는가**다 — 아레나에는 적이 여럿이고
 * 벽이 있고 코어를 주우러 가야 하므로, 한 프레임에서 되는 일이 판에서도 된다는 보장이 없다.
 *
 * **이 묶음은 세션 18이 아래쪽 꼬리를 쫓다가 생겼다.** 스무 판 중 가장 짧은 판(139초)은
 * 카드 운도 화력도 아니라 **몸으로 세 대 맞은 판**이었다(한 대 12점 = 화살 2.4발).
 * 같은 씨앗을 비키는 사람으로 돌리면 313초다. 예순 판으로 넓혀도 같다:
 * 몸통 35대 → 2대, 가장 짧은 판 89초 → 172초, **중앙값은 247초 그대로** —
 * 비키기는 아래쪽만 들어 올린다.
 *
 * 그래서 이 묶음이 지키는 것은 두 가지다.
 * (1) 돌진형은 실제로 아프다(안 비키면 맞는다). (2) 그런데 피할 수 있다.
 * 하나가 무너지면 이 적은 "피할 수 없는 적"이거나 "무해한 적"이 된다.
 */
describe('밸런스 — 예고를 보고 비키면 몸에 닿지 않는다 (DESIGN 9번)', () => {
  const dodged = SEEDS.map((seed) => playMatch(seed, 600, dodgeCharger));
  const bodyHits = (rows: readonly { bodyHits: number }[]): number =>
    rows.reduce((sum, r) => sum + r.bodyHits, 0);
  const shortest = (rows: readonly { elapsed: number }[]): number =>
    Math.min(...rows.map((r) => r.elapsed));

  it('안 비키는 사람은 몸으로 맞고, 비키는 사람은 그 1/4도 맞지 않는다', () => {
    const plain = bodyHits(results);
    const smart = bodyHits(dodged);
    console.log(
      `몸통 박치기 — 안 비키는 사람 ${plain}대 / 비키는 사람 ${smart}대 (스무 판)`,
    );
    // 맞는 사람이 없으면 비교가 뜻이 없다. 돌진형이 순해진 것도 여기서 걸린다.
    expect(plain, '안 비키는 사람이 몸통에 거의 맞지 않는다').toBeGreaterThanOrEqual(4);
    // 실측 12대 → 0대. 4배는 넉넉히 잡은 선이다.
    expect(smart * 4, `비키는 사람 ${smart}대 · 안 비키는 사람 ${plain}대`).toBeLessThanOrEqual(
      plain,
    );
  });

  it('아래쪽 꼬리는 게임의 성질이 아니라 안 비키는 버릇이다', () => {
    const plain = shortest(results);
    const smart = shortest(dodged);
    const lengths = dodged.map((r) => r.elapsed);
    console.log(
      `비키는 사람의 스무 판: 중앙값 ${median(lengths).toFixed(0)}초 · ` +
        `가장 짧은 판 ${smart.toFixed(0)}초(안 비키면 ${plain.toFixed(0)}초) · ` +
        `가장 긴 판 ${Math.max(...lengths).toFixed(0)}초`,
    );
    // 실측 139초 → 175초. 같은 씨앗·같은 카드인데 아래쪽 꼬리만 사라진다.
    expect(smart, '비켜도 가장 짧은 판이 길어지지 않는다').toBeGreaterThan(plain);
    // 위쪽에는 선을 걸지 않는다 — 비키는 사람은 원래 조금 더 오래 산다(실측 333초).
    // 그 천장을 지키는 것은 증원이고, 위 묶음이 안 비키는 사람으로 재고 있다.
    expect(median(lengths)).toBeGreaterThan(SHORTEST);
    expect(median(lengths)).toBeLessThan(LONGEST);
  });
});

/**
 * DESIGN 5번의 핵심 성질: **움직이면 피할 수 있고, 서 있으면 죽는다.**
 *
 * 적의 화살을 느리게 하고 쏘기 전에 멈춰 서게 한 것이 전부 이것을 위해서다.
 * 여기가 깨지면 (a) 적이 너무 정확해서 피할 방법이 없거나
 * (b) 적이 너무 무해해서 이동할 이유가 없다 — 둘 다 게임이 아니게 된다.
 */
describe('밸런스 — 움직이면 피하고, 서 있으면 죽는다', () => {
  /** 쓰러질 때까지 걸린 시간(s). 끝까지 살아남으면 돌린 시간을 그대로 돌려준다. */
  function survive(input: (w: World) => FrameInput, maxSeconds = 600): number {
    const world = new World();
    play(world, 60 * maxSeconds, input);
    return world.elapsed;
  }

  it('가만히 서 있으면 1분 안에 쓰러진다', () => {
    const standing = survive(() => IDLE, 120);
    console.log(`서 있기: ${standing.toFixed(0)}초 만에 쓰러짐`);
    expect(standing).toBeLessThan(60);
    // 곧바로 죽지도 않는다. 적이 걸어와 겨눌 시간은 있어야 무슨 일인지 보인다.
    expect(standing).toBeGreaterThan(10);
  });

  it('계속 움직이면 서 있을 때보다 세 배 넘게 버틴다', () => {
    const standing = survive(() => IDLE, 120);
    const moving = survive(walkToNearestCore);
    console.log(
      `서 있기 ${standing.toFixed(0)}초 vs 움직이기 ${moving.toFixed(0)}초 ` +
        `(${(moving / standing).toFixed(1)}배)`,
    );
    expect(moving).toBeGreaterThan(standing * 3);
  });
});
