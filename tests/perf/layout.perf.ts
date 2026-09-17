import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/World';
import { AIM, ARENA, ENEMY } from '../../src/data/config';
import { DEFAULT_MAP } from '../../src/data/maps';
import type { EnemySpawn } from '../../src/entities/types';
import {
  median,
  play,
  preferSupport,
  quantile,
  takeAny,
  walkToNearestCore,
  type Chooser,
} from '../support/match';

/**
 * **적이 처음 서는 자리가 무엇을 흔드는가** (DESIGN 10번 · 세션 86).
 *
 * 왜 여기에 있나: `data/maps.ts`가 여덟째 맵을 세우려는 사람에게 흔들 것 둘을 남겼고,
 * 세션 85가 그중 **반지름**을 재서 닫았다(`radius.perf.ts`). 남은 하나가 이것이다.
 * 그 파일의 배치 주석은 **"배치로 가를 수 있는 것은 처음 선 일곱이 한 번씩 쓰러질
 * 때까지"**라고 적어 두었다 — 쓰러진 적은 이 자리로 돌아오지 않고 플레이어 둘레
 * 고리에서 다시 서기 때문이다(`World.pickRespawnSpot` · 세션 49).
 * **그 '까지'가 몇 초인지는 아무도 안 쟀다. 이 자가 그것을 잰다.**
 *
 * **재는 법: 자리만 갈고 나머지는 전부 그대로 둔다.** 일곱 종류도, 종류마다의 거리도
 * 그대로 두고 **한 번에 한 축만** 흔든다 — 거리(가까이 · 멀리)와 방위(한쪽)다.
 * 맵은 빈 뜰 하나뿐이라 기둥이 끼어들지 않는다.
 *
 * **실측 — 걷는 사람 · 씨앗 예순 개 · 빈 뜰**(아래 표를 매번 다시 찍는다):
 * | 배치 | 지평선(p90) | 첫 피격 | ~15초 피해 | 60~120초 피해·처치 | 한 판 | 선 안 | 처치 |
 * |---|---|---|---|---|---|---|---|
 * | **지금** | **15초**(26) | 5초 | 13.5 | 21.5 · 53.1 | 226초 | 51/60 | 227 |
 * | 가까이(×0.6) | 13초(19) | 5초 | 11.7 | 19.4 · 56.0 | 250초 | 52/60 | 281 |
 * | 멀리(×1.2) | 14초(20) | 5초 | 12.6 | 18.3 · 56.7 | 264초 | 54/60 | 294 |
 * | 한쪽(90도 부채꼴) | 14초(21) | 4초 | 14.7 | 19.1 · 55.4 | 231초 | 49/60 | 244 |
 * | **지금(딴 씨앗)** | 15초(24) | 4초 | 12.0 | 17.6 · 55.7 | **257초** | 49/60 | **283** |
 * | 지금(보조 먼저) | 18초(26) | 5초 | 15.1 | 40.2 · 27.8 | 122초 | 14/60 | 63 |
 *
 * **답 ①: '까지'는 15초다.** 아무리 흔들어도 13~15초에서 안 움직인다(가장 약하게 자라는
 * 사람에게서도 18초 · p90 26초). 한 판이 226초이므로 **배치가 닿는 것은 판의 6%**이고,
 * 그 뒤로는 어느 배치든 같은 규칙으로 플레이어 둘레에 다시 선다.
 *
 * **답 ②: 그 6% 안에서도 배치는 씨앗보다 작게 가른다.** 판 길이는 226 / 250 / 264 / 231초로
 * 벌어지는데 **같은 배치를 딴 씨앗으로 돌리면 226 → 257초다**(처치 227 → 283).
 * 곧 저 폭은 배치가 가른 것이 아니라 씨앗이 구른 것이다 — 아래 ②가 그것을 자로 못 박는다.
 * 첫 피격(4~5초)도 지평선도 같은 자리에 있고, 유일하게 줄을 세울 수 있는 칸은
 * 처음 15초의 피해(11.7~15.1)인데 흔들림 바닥(13.5 vs 12.0)이 그 폭의 절반을 먹는다.
 *
 * **넷째 줄은 배치가 아니라 자다**(`지금(딴 씨앗)`). **같은 배치를 다른 씨앗 예순 개로
 * 한 번 더 돌린 줄**이고, 그것이 이 표의 **흔들림 바닥**이다. 이 줄 없이 판 길이를 읽으면
 * 씨앗이 구른 것을 배치가 가른 것으로 읽게 된다 — 세션 85의 반지름 표도 ×0.75에서 224초,
 * ×0.9에서 246초로 되짚어 올라간 적이 있다(단조롭지 않았다). **배치 줄들의 차이가 이
 * 줄과의 차이보다 크지 않으면, 그 차이는 잰 것이 아니다.**
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/layout.perf.ts
 */
const SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + i);
/** 흔들림 바닥을 재는 딴 씨앗 예순 개. 위와 겹치지 않게 뒤에 이어 붙인다. */
const OTHER_SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + 60 + i);

/** `tests/progression.test.ts`·`balance.perf.ts`와 같은 선. 세 자가 같은 자를 써야 견줄 수 있다. */
const SHORTEST = 150;
const LONGEST = 330;

/** 판이 끝나지 않아도 여기서 끊는다(s). `playMatch`의 기본값과 같다. */
const CAP = 600;

/**
 * **지평선 안**을 보는 창(s). 실측 지평선(중앙 13~15초)에 맞춘 값이다 —
 * 배치가 살아 있는 동안만 보려는 창이므로 그보다 넓으면 안 된다.
 */
const EARLY = 15;
/** **지평선 밖**을 보는 띠(s). 어느 배치든 처음 선 일곱이 한 번씩 쓰러지고도 한참 뒤다. */
const LATE = [60, 120] as const;

const BASE = DEFAULT_MAP.enemies;

/** 자리를 한복판에서 같은 배로 밀거나 당긴다. 방위와 종류는 건드리지 않는다. */
function scaled(mul: number): readonly EnemySpawn[] {
  return BASE.map((e) => ({
    ...e,
    x: Number((e.x * mul).toFixed(3)),
    y: Number((e.y * mul).toFixed(3)),
  }));
}

/**
 * 거리는 그대로 두고 **방위만** 한쪽으로 모은다. 일곱을 15도 간격의 90도 부채꼴에 세운다 —
 * 가장 가까운 둘도 3.4m 떨어져 있어(몸 반지름 0.7m) 판이 열리는 순간 서로 밀려나지 않는다.
 * 이 줄이 묻는 것 하나: **물러날 곳이 한쪽뿐이면 판의 첫머리가 달라지는가.**
 */
function fanned(): readonly EnemySpawn[] {
  const step = Math.PI / 12;
  const from = -step * (BASE.length - 1) * 0.5;
  return BASE.map((e, i) => {
    const r = Math.hypot(e.x, e.y);
    const a = from + i * step;
    return { ...e, x: Number((Math.cos(a) * r).toFixed(3)), y: Number((Math.sin(a) * r).toFixed(3)) };
  });
}

const LAYOUTS: readonly {
  name: string;
  enemies: readonly EnemySpawn[];
  seeds: readonly number[];
  choose?: Chooser;
}[] = [
  { name: '지금', enemies: BASE, seeds: SEEDS },
  /** 일곱이 전부 자동 조준 안(22m)으로 들어온다. 먼 넷은 13.0 → 12.1m라 겨누는 선 안이다. */
  { name: '가까이', enemies: scaled(0.6), seeds: SEEDS },
  /** 먼 넷이 24.1m로 물러나 **판이 열리는 순간 자동 조준 밖**이다(`AIM.autoRange` 22m). */
  { name: '멀리', enemies: scaled(1.2), seeds: SEEDS },
  { name: '한쪽', enemies: fanned(), seeds: SEEDS },
  { name: '지금(딴 씨앗)', enemies: BASE, seeds: OTHER_SEEDS },
  /**
   * **여섯째 줄도 배치가 아니라 자다.** 지평선은 "얼마나 빨리 눕히는가"로 정해지므로
   * 가장 약하게 자라는 사람에게서 가장 길다(`preferSupport` — `balance.perf.ts`의 ②가
   * 보는 그 사람). 이 줄이 **지평선의 위쪽 끝**이고, 그래서 ①의 선은 이 줄도 함께 지킨다.
   */
  { name: '지금(보조 먼저)', enemies: BASE, seeds: SEEDS, choose: preferSupport },
];

interface Run {
  seed: number;
  elapsed: number;
  defeated: boolean;
  level: number;
  kills: number;
  /** 체력이 처음 줄어든 시각(s). 한 번도 안 맞았으면 Infinity. */
  firstHit: number;
  /** 처음 선 하나가 처음 쓰러진 시각(s). */
  firstFall: number;
  /** **지평선** — 처음 선 일곱이 저마다 한 번씩은 쓰러진 시각(s). */
  horizon: number;
  /** 처음 `EARLY`초에 받은 피해와 처치. */
  hurtEarly: number;
  killsEarly: number;
  /** `LATE` 띠에서 받은 피해와 처치. 그 띠까지 못 간 판은 세지 않는다(`reachedLate`). */
  hurtLate: number;
  killsLate: number;
  reachedLate: boolean;
}

function runOne(seed: number, enemies: readonly EnemySpawn[], choose: Chooser = takeAny): Run {
  const world = new World({ seed, map: DEFAULT_MAP, enemies });
  // 처음 선 일곱은 배열의 앞자리에 그대로 있다 — 증원은 뒤에 밀어 넣고(`World.enemies.push`),
  // 쓰러진 적을 배열에서 지우는 코드는 없다(`mix.perf.ts`의 '일곱은 끝까지 있다').
  const starters = world.enemies.slice(0, enemies.length);
  const fell = starters.map(() => false);

  let firstHit = Infinity;
  let firstFall = Infinity;
  let horizon = Infinity;
  let hurtEarly = 0;
  let hurtLate = 0;
  let killsEarly = 0;
  let killsLate = 0;
  let reachedLate = false;

  const steps = Math.round(60 * CAP);
  for (let i = 0; i < steps && !world.defeated; i += 1) {
    const hp = world.player.hp;
    const kills = world.kills;
    play(world, 1, walkToNearestCore, choose);
    // 카드가 떠 있는 프레임은 시간이 흐르지 않는다(`World.isPaused`) — 띠에 넣지 않는다.
    if (world.isPaused) continue;
    const t = world.elapsed;

    const took = Math.max(0, hp - world.player.hp);
    if (took > 0 && firstHit === Infinity) firstHit = t;
    const got = world.kills - kills;
    if (t <= EARLY) {
      hurtEarly += took;
      killsEarly += got;
    }
    if (t >= LATE[0] && t <= LATE[1]) {
      reachedLate = true;
      hurtLate += took;
      killsLate += got;
    }

    if (horizon === Infinity) {
      for (let k = 0; k < starters.length; k += 1) {
        if (fell[k] || (starters[k]?.alive ?? true)) continue;
        fell[k] = true;
        if (firstFall === Infinity) firstFall = t;
      }
      if (fell.every(Boolean)) horizon = t;
    }
  }

  return {
    seed,
    elapsed: world.elapsed,
    defeated: world.defeated,
    level: world.progress.level,
    kills: world.kills,
    firstHit,
    firstFall,
    horizon,
    hurtEarly,
    killsEarly,
    hurtLate,
    killsLate,
    reachedLate,
  };
}

const inRange = (rows: readonly Run[]): number =>
  rows.filter((r) => r.elapsed >= SHORTEST && r.elapsed <= LONGEST).length;

const mid = (rows: readonly Run[], pick: (r: Run) => number): number => median(rows.map(pick));

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 표에서 가장 큰 값과 가장 작은 값의 비. 1에 가까울수록 그 칸은 배치를 못 가른다. */
function spread(values: readonly number[]): number {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo <= 0 ? Infinity : hi / lo;
}

describe(`적이 처음 서는 자리 — 배치 넷 + 흔들림 바닥 × 씨앗 ${SEEDS.length}개`, () => {
  /**
   * **재는 자리가 잴 값을 갖고 있는지 먼저 본다.** 이 검사는 판을 돌리지 않는다(공짜) —
   * 위 표를 읽기 전에 **두 줄이 정말로 거리를 흔들었는지**를 확인하는 자리다.
   * `멀리`가 자동 조준 안에 머물러 있으면 그 줄은 아무것도 안 흔든 줄이고,
   * 아레나 밖으로 나가면 벽에 잘려(`World`) 표가 거짓이 된다.
   */
  it('네 배치가 다 아레나 안이고, 멀리는 판이 열리는 순간 자동 조준 밖이다', () => {
    const limit = ARENA.radius - ENEMY.radius;
    for (const l of LAYOUTS) {
      for (const e of l.enemies) {
        const r = Math.hypot(e.x, e.y);
        expect(r, `${l.name}의 (${e.x}, ${e.y})`).toBeLessThan(limit);
      }
    }
    const reach = (name: string): number =>
      Math.max(...(LAYOUTS.find((l) => l.name === name)?.enemies ?? []).map((e) => Math.hypot(e.x, e.y)));
    expect(reach('멀리'), '멀리의 가장 먼 자리').toBeGreaterThan(AIM.autoRange);
    expect(reach('가까이'), '가까이의 가장 먼 자리').toBeLessThan(ENEMY.fireRange);
  });

  it('배치가 닿는 것은 판의 첫머리뿐이고, 그 첫머리도 길이를 못 가른다', () => {
    const tables = LAYOUTS.map((l) => ({
      name: l.name,
      rows: l.seeds.map((seed) => runOne(seed, l.enemies, l.choose)),
    }));

    const pad = (n: number, w = 3): string =>
      (Number.isFinite(n) ? n.toFixed(0) : '∞').padStart(w, ' ');
    console.log(
      [
        '',
        `  걷는 사람 · 빈 뜰 · 처음 ${EARLY}초(지평선 안)와 ${LATE[0]}~${LATE[1]}초(밖)를 갈라 센다`,
        `  ${'배치'.padEnd(12)}지평선(p90) 첫 쓰러짐 첫 피격 │ ` +
          `~${EARLY}초 피해·처치 │ ${LATE[0]}~${LATE[1]}초 피해·처치 │ 한 판 · 선 안 · 처치`,
        ...tables.map((t) => {
          const late = t.rows.filter((r) => r.reachedLate);
          const horizons = t.rows.map((r) => r.horizon).sort((a, b) => a - b);
          return (
            `  ${t.name.padEnd(14)}` +
            `${pad(mid(t.rows, (r) => r.horizon), 2)}초(${pad(quantile(horizons, 0.9), 2)})  ` +
            `${pad(mid(t.rows, (r) => r.firstFall), 2)}초    ` +
            `${pad(mid(t.rows, (r) => r.firstHit), 2)}초 │ ` +
            `${mean(t.rows.map((r) => r.hurtEarly)).toFixed(1).padStart(5)} · ` +
            `${mean(t.rows.map((r) => r.killsEarly)).toFixed(1).padStart(4)} │ ` +
            `${mean(late.map((r) => r.hurtLate)).toFixed(1).padStart(5)} · ` +
            `${mean(late.map((r) => r.killsLate)).toFixed(1).padStart(4)} │ ` +
            `${pad(mid(t.rows, (r) => r.elapsed))}초 · ${pad(inRange(t.rows), 2)}/${t.rows.length} · ` +
            `${pad(mid(t.rows, (r) => r.kills))}`
          );
        }),
        '',
      ].join('\n'),
    );

    const by = (name: string): Run[] => tables.find((t) => t.name === name)?.rows ?? [];
    const now = by('지금');
    const near = by('가까이');
    const far = by('멀리');
    const fan = by('한쪽');
    const floor = by('지금(딴 씨앗)');
    const layoutsOnly = [now, near, far, fan];

    // ① **지평선은 짧다 — 판의 첫 15초다.** 처음 선 일곱이 한 번씩 쓰러지고 나면 배치는
    //    지워진다(`World.pickRespawnSpot`이 그다음부터 플레이어 둘레 고리에서 고른다).
    //    자리를 어떻게 흔들어도 이 값이 안 움직이는 것이 이 표의 첫 번째 답이다.
    for (const t of tables) {
      const h = mid(t.rows, (r) => r.horizon);
      expect(h, `${t.name}의 지평선 ${h.toFixed(0)}초`).toBeLessThan(EARLY * 2);
    }

    // ② **지평선 밖은 흔들림 바닥 안이다.** 배치 넷의 한 판 길이가 벌어지는 폭이
    //    **같은 배치를 딴 씨앗으로 돌린 두 줄**이 벌어지는 폭을 넘지 않는다.
    //    넘는 날은 배치가 판 전체에 닿기 시작한 날이고, 그때 이 항목을 다시 읽어야 한다.
    const lengths = layoutsOnly.map((rows) => mid(rows, (r) => r.elapsed));
    const noise = spread([mid(now, (r) => r.elapsed), mid(floor, (r) => r.elapsed)]);
    expect(
      spread(lengths),
      `배치 넷의 한 판 ${lengths.map((v) => v.toFixed(0)).join(' / ')}초 · ` +
        `흔들림 바닥 ${mid(now, (r) => r.elapsed).toFixed(0)} vs ${mid(floor, (r) => r.elapsed).toFixed(0)}초`,
    ).toBeLessThan(noise * 1.15);

    // ③ 그래도 네 배치 모두 3~5분 안에 있다. ②가 "차이가 없다"를 재는 자라면,
    //    이 줄은 "그 없음이 선 안에서의 없음인지"를 재는 자다.
    //    **보조를 먼저 고르는 사람은 여기서 뺀다** — 그 사람의 판이 선 밑인 것은 그 사람의
    //    정의이지 배치의 탓이 아니다(`balance.perf.ts`의 `inWindow: false`. 그 사람만 보는
    //    선은 120초이고 이 표에서도 122초로 같다 — 두 자가 같은 게임을 잡고 있다는 뜻이다).
    for (const rows of [...layoutsOnly, floor]) {
      const m = mid(rows, (r) => r.elapsed);
      expect(m, `한 판 ${m.toFixed(0)}초`).toBeGreaterThan(SHORTEST);
      expect(m, `한 판 ${m.toFixed(0)}초`).toBeLessThan(LONGEST);
    }
    // 보조를 먼저 고르는 사람은 제 선으로 잰다(`balance.perf.ts`의 ②와 같은 120초).
    const weak = mid(by('지금(보조 먼저)'), (r) => r.elapsed);
    expect(weak, `보조를 먼저 고르는 사람 ${weak.toFixed(0)}초`).toBeGreaterThan(120);
  });
});
