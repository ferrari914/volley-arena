import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import type { FrameInput } from '../src/core/World';
import { ARENA, CORE, ENEMY, LEVEL, PLAYER } from '../src/data/config';
import { createXpCore, type XpCore } from '../src/entities/types';
import { isOffScreen, makeProjector } from './support/camera';
import {
  DT,
  IDLE,
  circleShield,
  dodgeCharger,
  median,
  play,
  playMatch,
  preferPower,
  quantile,
  walkToNearestCore,
} from './support/match';
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

/** 씨앗은 고정한다. 바퀴마다 다른 판을 재면 수치를 비교할 수 없다. */
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);
/** 코어만 보고 걷는 사람의 스무 판. 아래 묶음들이 같은 스무 판을 나눠 본다. */
const results = SEEDS.map((seed) => playMatch(seed));

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
    // 스무 판의 첫 1분을 재서 중앙값을 본다(세션 41이 씨앗 하나에서 넓혔다).
    // 판마다 만나는 적의 수가 다르므로 한 판은 8.25~12.17 XP/s로 흔들린다 —
    // 중앙값은 씨앗 블록을 여섯 번 옮겨도 9.4~10.6 XP/s에 머문다.
    const rates = SEEDS.map((seed) => {
      const world = new World({ seed });
      play(world, 60 * seconds, walkToNearestCore);
      return world.xpByOrigin.drop / seconds;
    }).sort((a, b) => a - b);
    const dropRate = median(rates);
    // 눈으로도 볼 수 있게 남긴다. 밸런스를 만질 때 이 수치를 보고 판단한다.
    console.log(
      `전투 수입 스무 판: 중앙 ${dropRate.toFixed(2)} XP/s · ` +
        `가장 적은 판 ${(rates[0] ?? 0).toFixed(2)} · 가장 많은 판 ${(rates[rates.length - 1] ?? 0).toFixed(2)} · ` +
        `채집 상한 ${ambientCeiling.toFixed(2)} XP/s (${(dropRate / ambientCeiling).toFixed(1)}배)`,
    );
    // 실측 27배다. 선이 헐거운 것은 일부러다 — DESIGN이 요구하는 것은 "확실히 빠르게"이고,
    // 여기가 3배까지 좁혀졌다면 그것은 이미 기획이 뒤집힌 판이다.
    expect(dropRate).toBeGreaterThan(ambientCeiling * 3);
  });

  it('한 판이 끝나고 오른 레벨이 남김없이 카드가 된다', () => {
    const levels = results.map((r) => r.level).sort((a, b) => a - b);
    console.log(
      `스무 판의 레벨: 중앙 Lv${median(levels).toFixed(0)} · ` +
        `가장 낮은 판 Lv${levels[0]} · 가장 높은 판 Lv${levels[levels.length - 1]}`,
    );

    // 레벨업 한 번이 카드 한 장이다(4번). **이것은 씨앗과 무관한 불변식이라 스무 판 전부에 건다.**
    for (const row of results) {
      expect(row.defeated, `씨앗 ${row.seed}의 판이 10분 안에 끝나지 않았다`).toBe(true);
      expect(row.cards.length, `씨앗 ${row.seed}: Lv${row.level}인데 카드 ${row.cards.length}장`).toBe(
        row.level - 1,
      );
    }
    // 자라는 양에는 중앙값으로 건다 — 한 판에 10장 밑이면 심심하다(실측 중앙 Lv16.5 · 가장 낮은 판 Lv11).
    expect(median(levels)).toBeGreaterThanOrEqual(10);
    // **"한 판 3~5분"은 여기서 재지 않는다.** 아래 '한 판 길이' 묶음이 같은 스무 판으로 잰다.
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
/** 판이 영영 안 끝나는 고장을 잡는 선(초). 흔들리는 극단값이라 관측된 최악보다 한참 위에 둔다. */
const RUNAWAY = 480;
/** 예고를 보고 비키는 사람의 같은 스무 판(세션 18). 두 번째 자다 — 한 사람만 재면 버릇을 게임으로 오해한다. */
const dodged = SEEDS.map((seed) => playMatch(seed, 600, dodgeCharger));
/** 방패병을 옆구리로 도는 사람의 같은 스무 판(세션 24). 세 번째 자다. */
const circled = SEEDS.map((seed) => playMatch(seed, 600, circleShield));

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

  /**
   * **증원(`REINFORCE`)이 사 온 보장이 이것이다.** 증원이 없던 때는 화력이 세게 자란
   * 씨앗의 판이 391초까지, 카드를 잘 고르는 사람은 514초까지 갔다 — 판 길이가
   * 곧 화력의 함수여서 위쪽에 천장이 없었다. 지금은 시간이 갈수록 아레나가 무거워져
   * 천장이 생긴다.
   *
   * **세 사람을 다 본다(세션 25).** 세션 24까지 이 검사는 코어만 보고 걷는 사람 하나만
   * 봤고, 그동안 **비키는 사람의 가장 긴 판은 491초였다** — 검사가 통과하는 내내
   * 선 밖에 있었다. 잘 하는 사람일수록 위쪽 꼬리가 길어지는데(덜 맞으니 더 오래 산다)
   * 가장 서툰 자 하나로만 천장을 재고 있었던 것이다.
   *
   * **왜 '가장 긴 판'이 아니라 p90인가 — 그 자는 씨앗을 재고 있었다 (세션 40).**
   * 세션 25가 "이 자가 흔들린다"고 적어 둔 것을 실제로 재 봤다. **게임을 한 줄도
   * 바꾸지 않고** 씨앗 블록만 20개씩 옮겨 여섯 번 재니, 사람별 '가장 긴 판'이
   * **286~396초**로 흔들렸다 — 합격선 360이 그 폭 한가운데에 있었다. 즉 이 검사는
   * 그동안 게임이 아니라 **어느 씨앗 스무 개를 골랐는지**를 재고 있었고,
   * 통과 여부가 동전 던지기였다. (세션 39가 증원을 32/10 → 28/12로 옮긴 것도
   * 일부는 이 자를 달래려던 값이다. 다음에 이 선이 깨지면 값을 옮기기 전에
   * **씨앗 블록을 바꿔 두 번 더 재 보라** — 한 판 차이로 깨졌으면 그건 씨앗이다.)
   *
   * **대신 예순 판(세 사람 × 씨앗 20개)을 한 묶음으로 보고 p90을 쓴다.** 같은 여섯
   * 블록에서 p90은 **296~318초**로 폭이 23초다(위 자의 4분의 1). 극단값 하나가
   * 자를 흔들지 못하면서, 천장이 무너지는 것은 그대로 잡는다 — 실제로 증원을
   * 세션 16 수준(60초 간격·여덟 자리)으로 되돌려 재면 **p90 355초 · 가장 긴 판 494초**로
   * 두 선이 다 깨진다.
   *
   * **선은 두 개다.** p90은 `LONGEST`(330초)와 같은 선을 쓴다 — "열에 아홉은 3~5분 안에
   * 끝난다"가 DESIGN 품질 기준을 그대로 옮긴 문장이다. 그리고 어떤 판도 8분을 넘지 않는다:
   * 이쪽은 극단값이라 흔들리므로 관측된 최악(396초)보다 훨씬 위에 두고, **판이 영영
   * 안 끝나는 고장**만 잡는 자로 쓴다.
   *
   * 이 선이 깨지면 증원이 약해진 것이다. 선을 옮기지 말고 `REINFORCE`를 되돌릴 것.
   */
  it('위쪽 꼬리 — 예순 판 중 열에 아홉이 5분 반 안에 끝난다', () => {
    const pooled = [...results, ...dodged, ...circled].map((r) => r.elapsed);
    const sorted = [...pooled].sort((a, b) => a - b);
    const p90 = quantile(sorted, 0.9);
    const longest = sorted[sorted.length - 1] ?? 0;
    const longestOf = (rows: readonly { elapsed: number }[]): string =>
      Math.max(...rows.map((r) => r.elapsed)).toFixed(0);
    console.log(
      `위쪽 꼬리 ${pooled.length}판 — p90 ${p90.toFixed(0)}초(합격선 ${LONGEST}) · ` +
        `가장 긴 판 ${longest.toFixed(0)}초(합격선 ${RUNAWAY}) · ` +
        `사람별 가장 긴 판 ${longestOf(results)} · ${longestOf(dodged)} · ${longestOf(circled)}초 ` +
        `(이 셋은 씨앗에 따라 ±50초씩 흔들린다 — 판단하지 말 것)`,
    );
    expect(p90, `예순 판의 p90 ${p90.toFixed(0)}초`).toBeLessThan(LONGEST);
    expect(longest, `가장 긴 판 ${longest.toFixed(0)}초`).toBeLessThan(RUNAWAY);
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
 * DESIGN 품질 기준: **"처음 하는 사람이 설명 없이 30초 안에 조작을 이해할 것."**
 *
 * 세션 18이 스크린샷(0:02)에서 찾은 고장이 여기 있었다 — 체력바가 이미 깎여 있고
 * 돌진형이 몸에 붙어 있었다. 처음 선 적이 전부 `fireCooldown` 0으로 태어나
 * **첫 프레임부터 겨눴기** 때문이다(배치의 활잡이 둘이 `fireRange` 안쪽인 13m에 선다).
 * 180판으로 재니 첫 피격이 3초 안에 온 판이 90판, 2초 안이 63판이었다.
 *
 * `ENEMY.startDelay`가 그 자리를 막는다. **여기서 재는 것은 그 값이 화면이 아니라
 * 판에서 실제로 통하는가**다 — 한 프레임짜리 검사(`tests/world.test.ts`)는
 * "준비 시간 동안 겨누지 않는다"까지만 보고, 그 뒤 실제로 언제 첫 대가 오는지는 못 본다.
 * 두 사람(안 비키는 사람 · 비키는 사람)으로 함께 재는 이유는 세션 18과 같다:
 * 한 사람의 버릇을 게임의 성질로 오해하지 않기 위해서다.
 */
describe('밸런스 — 판을 열고 3초 안에는 아무도 맞지 않는다', () => {
  const firstHits = [...results, ...dodged].map((r) => r.firstHit).sort((a, b) => a - b);

  it('가장 이른 첫 피격도 3초보다 이르지 않다', () => {
    const earliest = firstHits[0] ?? Infinity;
    console.log(
      `첫 피격 — 가장 이른 판 ${earliest.toFixed(1)}초 · 중앙값 ${median(firstHits).toFixed(1)}초 ` +
        `(마흔 판 · 준비 시간 ${ENEMY.startDelay}초)`,
    );
    // 준비 시간이 판에서 실제로 통하는지부터 본다. 어느 한 자리(증원·부활·되살아남)에서
    // 새 적이 준비 없이 태어나면 여기가 먼저 걸린다.
    expect(earliest, '준비 시간이 끝나기도 전에 맞았다').toBeGreaterThan(ENEMY.startDelay);
    // 실측 3.0초. 이 선이 깨지면 `ENEMY.startDelay`를 되돌릴 것이지, 선을 옮기지 말 것.
    expect(earliest).toBeGreaterThanOrEqual(3);
  });

  it('그렇다고 첫 대가 영영 오지 않는 것은 아니다', () => {
    // 반대쪽 고장도 함께 막는다. 준비 시간을 늘리면 판이 순해지고,
    // "서 있으면 죽는다"(아래 묶음)가 먼저 무너진다 — 실측 3.0초로 준 값이 30초 이상이면
    // 그것은 준비 시간이 아니라 게임을 무르게 만든 것이다.
    expect(median(firstHits)).toBeLessThan(30);
    for (const r of [...results, ...dodged]) {
      expect(Number.isFinite(r.firstHit), `씨앗 ${r.seed}에서 한 번도 맞지 않았다`).toBe(true);
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
 * DESIGN 9번이 방패병에게 요구하는 단 하나의 대응: **옆구리로 돌면 뚫린다.**
 *
 * 한 프레임짜리 검사는 `tests/enemies.test.ts`에 있다(`blocksArrow`의 세 조건).
 * 여기서 재는 것은 그것이 **한 판 내내 실제로 통하는가**다 — 판이 도는 속도가
 * `SHIELD.turnRate`(0.8rad/s)라, 규칙이 맞더라도 **돌아가는 데 드는 시간**이 정면으로
 * 부수는 시간보다 길면 이 적의 규칙은 화면에서 거짓말이 된다.
 *
 * **세션 24가 이 묶음을 만든 이유는 세션 18과 같다.** 세션 23이 "방패병이 판 길이를
 * 양쪽으로 벌렸다"고 적었는데(선 안 141 → 124/180), 그 표를 잰 사람이 돌 줄 모르는
 * 사람이었다. 도는 사람으로 다시 재니 아래쪽 끝은 66 → 101초로 닫혔다
 * (`npm run perf`의 둘째 표). **아래쪽은 게임이 아니라 버릇이었다.**
 * (위쪽은 아니다 — 도는 사람의 잘 고르는 판이 451초까지 간다. STATUS '다음 할 일'.)
 *
 * 그래서 이 묶음이 지키는 것은 둘이다.
 * (1) 정면으로만 쏘면 실제로 막힌다. (2) 그런데 돌면 뚫린다.
 * 하나가 무너지면 방패병은 "그냥 체력 8인 적"이거나 "돌 수 없는 벽"이 된다.
 */
describe('밸런스 — 옆구리로 돌면 판이 뚫린다 (DESIGN 9번)', () => {
  /**
   * 방패병 하나만 세운 60초. 스무 판으로 재면 활잡이·돌진형이 함께 뒤섞여
   * "막힌 화살"이 방패병 하나당 몇 발인지가 흐려진다 — 여기서는 그 하나만 본다.
   */
  function duel(input: (w: World) => FrameInput): World {
    const world = new World({ seed: SEEDS[0] ?? 0, enemies: [{ x: 10, y: 0, kind: 'shield' }] });
    play(world, 60 * 60, input);
    return world;
  }

  it('정면으로만 쏘면 막히고, 돌면 그 2/3도 막히지 않는다', () => {
    const plain = duel(walkToNearestCore);
    const smart = duel(circleShield);
    console.log(
      `방패병 하나와 60초 — 안 도는 사람 막힘 ${plain.blockedShots}발/${plain.kills}처치 · ` +
        `도는 사람 막힘 ${smart.blockedShots}발/${smart.kills}처치`,
    );
    // 막히는 사람이 없으면 비교가 뜻이 없다. 방패가 순해진 것도 여기서 걸린다.
    expect(plain.blockedShots, '정면으로 쏘는데도 막히지 않는다').toBeGreaterThanOrEqual(20);
    // 실측 35발 → 20발. 도는 데 드는 시간(붙는 거리 3m에서 약 1초)이 길어지면 여기가 먼저 운다.
    expect(smart.blockedShots * 1.5, `도는 사람 ${smart.blockedShots}발`).toBeLessThanOrEqual(
      plain.blockedShots,
    );
    // 돌다가 못 잡으면 그것은 대응이 아니다. 실측 10처치 → 11처치.
    expect(smart.kills).toBeGreaterThanOrEqual(plain.kills);
  });

  it('아래쪽 꼬리는 게임의 성질이 아니라 돌 줄 모르는 버릇이다', () => {
    const plain = Math.min(...results.map((r) => r.elapsed));
    const smart = Math.min(...circled.map((r) => r.elapsed));
    const lengths = circled.map((r) => r.elapsed);
    console.log(
      `도는 사람의 스무 판: 중앙값 ${median(lengths).toFixed(0)}초 · ` +
        `가장 짧은 판 ${smart.toFixed(0)}초(안 돌면 ${plain.toFixed(0)}초) · ` +
        `막힘 ${circled.reduce((a, r) => a + r.blocked, 0)}발` +
        `(안 돌면 ${results.reduce((a, r) => a + r.blocked, 0)}발)`,
    );
    // 실측 94초 → 182초. 같은 씨앗·같은 카드인데 아래쪽 꼬리만 사라진다(세션 18의 비키기와 같다).
    expect(smart, '돌아도 가장 짧은 판이 길어지지 않는다').toBeGreaterThan(plain);
    // 중앙값은 제자리다 — 돌기는 아래쪽만 들어 올린다(실측 256 → 266초).
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
 *
 * **세션 41이 자를 씨앗 하나에서 스무 판으로 옮겼다.** 그전까지 이 묶음은 `new World()`로
 * 기본 씨앗 한 판만 재서 60초 선과 견줬다(그 한 판이 48초였다). 스무 판으로 넓혀 보니
 * **그 한 판이 위에서 둘째로 오래 버티는 판**이었다 — 같은 게임의 스무 판은 37~52초이고
 * 중앙값은 40초다. 선까지 남은 여유가 12초인 줄 알았지만 실제로는 20초였고,
 * 무엇보다 **그 12초는 게임이 아니라 씨앗이 정하고 있었다**(세션 40의 규칙).
 */
describe('밸런스 — 움직이면 피하고, 서 있으면 죽는다 (씨앗 20개)', () => {
  /**
   * 손을 대지 않은 스무 판. 씨앗은 위 묶음과 같은 자리라(`SEEDS`) `results`와 짝이 맞는다 —
   * 같은 판을 한 번은 서서, 한 번은 걸어 다니며 산 셈이다.
   *
   * 120초에서 끊는다. 서 있는 사람은 실측 최장 52초에 쓰러지므로 두 배 넘는 여유이고,
   * 만에 하나 영영 안 죽는 판이 생기면 120으로 잡혀 아래 선이 운다.
   */
  const standing = SEEDS.map((seed) => {
    const world = new World({ seed });
    play(world, 60 * 120, () => IDLE);
    return world.elapsed;
  });
  const sorted = [...standing].sort((a, b) => a - b);
  const shortestStand = sorted[0] ?? 0;
  const longestStand = sorted[sorted.length - 1] ?? 0;

  /**
   * 선은 중앙값에 건다(세션 40의 규칙). **스무 판의 중앙값은 씨앗 블록을 옮겨도 거의 안 움직인다** —
   * 게임을 한 줄도 바꾸지 않고 블록만 여섯 번 옮겨 재니 중앙값 39~42초 · 가장 긴 판 45~52초였다
   * (예순 판으로 넓히면 중앙값은 여섯 블록 모두 39초다).
   *
   * **이가 있는지 확인했다**: 적 화살의 `damage`를 5 → 3으로 무르게 하면
   * 중앙 63초 · 최장 83초로 두 선이 함께 깨진다.
   *
   * **이 자는 더 이상 `ENEMY.startDelay`를 붙잡지 못한다.** 세션 19는 이 검사를 startDelay의
   * 천장으로 읽었지만(“3.0 → 서 있기 68초”), 그것도 씨앗 하나의 값이었다. 지금 스무 판으로
   * 재면 3.0초에서 중앙 42초이고, **15초까지 늘려도 예순 판 중앙값이 58초**다. 판의 첫머리를
   * 지키는 것은 이 자가 아니라 위의 첫 피격 검사들이다.
   */
  it('가만히 서 있으면 1분 안에 쓰러진다', () => {
    console.log(
      `서 있기 스무 판: 중앙값 ${median(standing).toFixed(0)}초 · ` +
        `가장 짧은 판 ${shortestStand.toFixed(0)}초 · 가장 긴 판 ${longestStand.toFixed(0)}초`,
    );
    expect(median(standing), '서 있어도 웬만해선 안 죽는다').toBeLessThan(60);
    // 운이 좋은 판에도 천장이 있어야 한다. 실측 52초 · 여섯 블록 최장 55초라 23초를 남긴 선이다.
    expect(longestStand, '가장 운 좋은 판이 너무 오래 버틴다').toBeLessThan(75);
    // 곧바로 죽지도 않는다. 적이 걸어와 겨눌 시간은 있어야 무슨 일인지 보인다(실측 37초).
    expect(shortestStand).toBeGreaterThan(10);
  });

  /**
   * 움직이는 쪽은 이미 스무 판이 있다(`results` — 같은 씨앗을 코어 보고 걷는 사람이 산 판).
   * **판끼리 나누지 않고 중앙값끼리 견준다**: 같은 씨앗의 두 판을 나눈 배율은 스무 판에서
   * 2.0~9.6배로 흩어져(중앙 5.6배), 한 판만 집으면 3배 선이 동전 던지기가 된다 —
   * 스무 판 중 한 판은 실제로 2.0배다. 중앙값끼리는 여섯 블록에서 5.4~6.8배로 붙어 있다.
   *
   * **이 선은 헐겁다는 것을 적어 둔다.** 적 화살을 플레이어 화살만큼 빠르게 하고(16 → 34)
   * 겨누는 예고까지 걷어내도(`aimTime` 0.5 → 0.1) 중앙끼리 4.2배가 남는다 — 걸어 다니는 쪽이
   * 오래 사는 이유의 큰 몫은 피하는 것이 아니라 **코어를 주워 자라는 것**이기 때문이다.
   * 그러니 이 검사는 "이동이 게임을 연다"는 바닥선이지 "피할 수 있다"의 증명이 아니다.
   * **피하기 자체는 바로 아래 검사가 잰다**(세션 42 · 날아온 화살 중 몇 발을 맞았는가).
   */
  it('계속 움직이면 서 있을 때보다 세 배 넘게 버틴다', () => {
    const moving = median(results.map((r) => r.elapsed));
    const stood = median(standing);
    console.log(
      `중앙값끼리 — 서 있기 ${stood.toFixed(0)}초 vs 움직이기 ${moving.toFixed(0)}초 ` +
        `(${(moving / stood).toFixed(1)}배)`,
    );
    expect(moving).toBeGreaterThan(stood * 3);
  });

  /**
   * **피하기 자체를 재는 자**(세션 42). 위 두 검사는 *얼마나 오래 사는가*를 보는데,
   * 오래 사는 데는 피하기 말고도 길이 있다 — 코어를 주워 자라면 적을 빨리 눕혀
   * **날아오는 화살 자체가 줄어든다**(같은 30초에 서 있는 사람에게 28발, 걷는 사람에게 17발).
   * 그래서 맞은 횟수를 그냥 세면 자란 사람이 피한 사람처럼 보인다.
   *
   * **날아온 것으로 나눈다**(`arrowHits / enemyShots`). 남는 것은 자란 몫이 빠진
   * "겨눠서 쏜 화살 중 몇 발이 몸에 꽂혔는가" 하나다. DESIGN 5번이 적 화살을 느리게 하고
   * (`ENEMY.arrow.speed` 16 — 플레이어 화살의 절반 이하) 쏘기 전에 멈춰 세운
   * (`aimTime`) 이유가 바로 이 비율이다.
   *
   * **같은 30초만 본다.** 위 검사들처럼 쓰러질 때까지 돌리면 서 있는 사람은 40초,
   * 걷는 사람은 230초를 사는데, 그 둘은 증원도 레벨도 다른 판이라 비율을 견줄 수 없다.
   * 30초는 서 있는 스무 판이 **모두 살아 있는** 가장 긴 창이다(가장 짧은 판 37초).
   *
   * **이가 둘이다**(같은 스무 판으로 잰 것):
   * - 적이 피할 수 없게 되면 — 화살을 플레이어만큼 빠르게(16 → 34) 하면 배율 3.7 → **2.28배**로
   *   선이 깨진다. 예고까지 함께 걷어내면(`aimTime` 0.5 → 0.1) 2.03배다.
   *   (예고만 걷어내는 것은 이 자가 못 잡는다 — 3.12배. 판의 첫머리를 지키는 첫 피격 검사의 몫이다.)
   * - 적이 무해해지면 — 조준 흔들림을 열 배로(`spread` 0.06 → 0.6) 하면 서 있는 사람의
   *   피격률이 0.500 → **0.097**로 무너져 서기 선이 깨진다. 맞지 않는 적은 피할 이유도 없다.
   *
   * **씨앗 블록을 여섯 번 옮겨 확인했다**: 20판 배율 3.00~3.75 · 60판 2.91~3.87
   * (서기 쪽은 여섯 블록 모두 0.500이다). 선은 2.5배에 둔다.
   */
  describe('피하기 — 날아온 화살 중 몇 발을 맞는가', () => {
    /** 서 있는 스무 판이 모두 살아 있는 창(s). 가장 짧은 판이 37초다(위 검사). */
    const WINDOW = 30;
    /** 같은 창을 같은 씨앗으로 살아 본 뒤, 날아온 화살과 몸에 꽂힌 화살을 돌려준다. */
    const fly = (seed: number, input: (w: World) => FrameInput) => {
      const world = new World({ seed });
      play(world, 60 * WINDOW, input);
      return { shots: world.enemyShots, hits: world.arrowHits };
    };
    const rate = (r: { shots: number; hits: number }) => (r.shots > 0 ? r.hits / r.shots : 0);
    const stood = SEEDS.map((seed) => fly(seed, () => IDLE));
    const moved = SEEDS.map((seed) => fly(seed, walkToNearestCore));

    it('서 있으면 날아온 화살의 3분의 1 이상을 맞고, 걸어 다니면 4분의 1도 안 맞는다', () => {
      const standRate = median(stood.map(rate));
      const moveRate = median(moved.map(rate));
      console.log(
        `${WINDOW}초 스무 판 — 서기: 쏜 ${median(stood.map((r) => r.shots)).toFixed(0)}발 중 ` +
          `${median(stood.map((r) => r.hits)).toFixed(0)}발(${standRate.toFixed(3)}) · ` +
          `걷기: 쏜 ${median(moved.map((r) => r.shots)).toFixed(0)}발 중 ` +
          `${median(moved.map((r) => r.hits)).toFixed(0)}발(${moveRate.toFixed(3)}) · ` +
          `${(standRate / moveRate).toFixed(2)}배`,
      );
      // 한 발도 안 날아온 판이 있으면 그 판의 비율은 0이고, 그것은 '다 피했다'로 읽힌다.
      expect(Math.min(...stood.map((r) => r.shots), ...moved.map((r) => r.shots))).toBeGreaterThan(0);
      // 적이 무해하면 여기가 먼저 운다(실측 0.500 · `spread`를 열 배로 하면 0.097).
      expect(standRate, '서 있는 사람에게도 화살이 잘 빗나간다').toBeGreaterThan(0.35);
      // 피할 수 없으면 여기가 운다(실측 0.136 · 여섯 블록 최대 0.172).
      expect(moveRate, '걸어 다녀도 그대로 맞는다').toBeLessThan(0.25);
      expect(standRate / moveRate, '움직이는 것이 피하는 것이 되지 못한다').toBeGreaterThan(2.5);
    });
  });
});


/**
 * **화면 — 바닥이 코어로 덮이지 않는다** (세션 27·28이 화면에서 본 것 · 세션 40이 자로 세웠다).
 *
 * 세션 27·28이 다 자란 사람의 화면을 찍어 세어 보니 **코어 46 · 적 5 · 화살 15**였다.
 * 프레임 문제가 아니라 **읽히는가**의 문제다 — 움직이는 것(적·화살)보다 바닥에 누운 것이
 * 먼저 눈에 들면, 처음 하는 사람은 무엇을 봐야 하는지 알 수 없다
 * (DESIGN 품질 기준 "설명 없이 30초 안에 조작을 이해할 것").
 *
 * **한 장으로 판정하지 않는다**(세션 39가 뭉침에서 겪은 것). 스크린샷은 한 프레임이라
 * 그날의 운이 섞인다. 여기서는 스무 판을 돌리며 **모바일 화면에 실제로 든 것만** 센다
 * (`tests/support/camera.ts`의 투영 — `npm run qa`가 찍는 그 창과 같은 화면비).
 *
 * **재는 사람은 화력을 먼저 고르는 사람이다.** 바닥을 덮는 것은 처치 속도이므로
 * 가장 빨리 죽이는 사람의 화면이 최악이다(다른 자들의 화면은 이보다 늘 헐겁다).
 *
 * 고치기 전후(같은 스무 판 · 화면에 든 코어의 판별 최댓값, 그 중앙):
 *   3알 × 5  → **29.5개** · 코어/(적+화살) p95의 중앙 **1.49** (최악 2.00)
 *   1알 × 15 → **10.5개** · 그 비율 **0.60** (최악 0.83)
 */
describe('화면 — 바닥의 코어가 적과 화살을 덮지 않는다', () => {
  /** `npm run qa`가 찍는 모바일 가로 창. 옆으로 보이는 거리는 화면비의 함수라 이 창으로 잰다. */
  const MOBILE = 844 / 390;
  /** 화면에 든 코어 수의 판별 최댓값, 그 중앙(개). 고치기 전 29.5였다. */
  const PEAK_LINE = 18;
  /** 화면에서 코어가 적+화살의 몇 배인가. 1을 넘으면 바닥이 더 눈에 든다. */
  const RATIO_LINE = 1.0;

  it('가장 빨리 죽이는 사람의 화면에서도 코어가 적·화살보다 많지 않다', () => {
    const rig = makeProjector(MOBILE);
    const peaks: number[] = [];
    const ratios: number[] = [];
    for (const seed of SEEDS) {
      const world = new World({ seed });
      const framePeak: number[] = [];
      const frameRatio: number[] = [];
      for (let i = 0; i < 60 * 600 && !world.defeated; i += 1) {
        play(world, 1, walkToNearestCore, preferPower);
        // 1초에 한 프레임만 센다. 투영이 프레임마다 카메라를 다시 세우는 일이라
        // 스무 판을 매 프레임 재면 검사 하나가 몇 초를 먹는다.
        if (i % 60 !== 0) continue;
        rig.place(world.player.pos);
        const onScreen = (x: number, y: number, h: number): boolean =>
          !isOffScreen(rig.project(x, y, h));
        let cores = 0;
        for (const core of world.cores) {
          if (core.alive && onScreen(core.pos.x, core.pos.y, CORE.radius + 0.5)) cores += 1;
        }
        let movers = 0;
        for (const enemy of world.enemies) {
          if (enemy.alive && onScreen(enemy.pos.x, enemy.pos.y, 0.85)) movers += 1;
        }
        for (const arrow of world.arrows) {
          if (arrow.alive && onScreen(arrow.pos.x, arrow.pos.y, 0.9)) movers += 1;
        }
        framePeak.push(cores);
        frameRatio.push(cores / Math.max(1, movers));
      }
      framePeak.sort((a, b) => a - b);
      frameRatio.sort((a, b) => a - b);
      peaks.push(framePeak[framePeak.length - 1] ?? 0);
      // 한 프레임의 최악이 아니라 그 판의 p95다 — 코어를 쓸어 담기 직전의 한 순간이
      // 판 전체를 대표하지 않는다(`tests/loadScene.test.ts`가 반대쪽에서 겪은 것과 같다).
      ratios.push(quantile(frameRatio, 0.95));
    }
    const peak = median(peaks);
    const ratio = median(ratios);
    console.log(
      `화면에 든 코어 — 판별 최댓값의 중앙 ${peak.toFixed(1)}개(합격선 ${PEAK_LINE}) · ` +
        `가장 나쁜 판 ${Math.max(...peaks)}개 · ` +
        `코어/(적+화살) p95의 중앙 ${ratio.toFixed(2)}(합격선 ${RATIO_LINE}) · ` +
        `가장 나쁜 판 ${Math.max(...ratios).toFixed(2)}`,
    );
    expect(peak, `화면에 든 코어 최댓값의 중앙 ${peak.toFixed(1)}개`).toBeLessThanOrEqual(PEAK_LINE);
    expect(ratio, `코어/(적+화살) ${ratio.toFixed(2)}`).toBeLessThanOrEqual(RATIO_LINE);
  });
});
