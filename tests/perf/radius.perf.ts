import { describe, expect, it } from 'vitest';
import { ARENA, ENEMY, REINFORCE } from '../../src/data/config';
import { DEFAULT_MAP } from '../../src/data/maps';
import {
  median,
  playMatch,
  preferPower,
  preferSupport,
  quantile,
  takeAny,
  walkToNearestCore,
  type Chooser,
  type MatchResult,
} from '../support/match';

/**
 * **아레나 반지름이 무엇을 흔드는가** (DESIGN 10번 · 세션 85).
 *
 * 왜 여기에 있나: `data/maps.ts`가 "반지름은 맵마다 가르지 않는다"고 못 박아 두었고,
 * STATUS가 여덟째 맵을 세우려는 사람에게 **가림 말고 흔들 것 둘** 중 하나로 이것을
 * 남겨 두었다("값이 싸지 않다 — 먼저 재서 적어라"). 이 자가 그 값을 잰다.
 *
 * **재는 법: 반지름만 갈고 나머지는 그대로 둔다.** 아레나를 통째로 닮은꼴로 늘렸다 줄인다 —
 * 반지름 · 증원 고리(`REINFORCE.spawnRadius`) · 적이 처음 서는 자리를 **같은 배로** 곱한다.
 * 곱하지 않는 것이 하나 있고 그것이 이 표의 답이다: **적의 사거리**(`ENEMY.fireRange` 15m).
 *
 * **`ARENA`와 `REINFORCE`를 실행 중에 고쳤다 되돌린다.** 이 둘은 `World`가 매번 읽는
 * 값이라 그렇게 할 수 있다. 맵이 반지름을 가를 수 있게 되면 이 손장난은 사라져야 하고,
 * **지금 그렇게 하지 않기로 한 근거가 바로 아래 표다.** `vitest.perf.config.ts`가
 * `fileParallelism: false`라 다른 파일과 겹치지 않고, 되돌리기는 `finally`가 맡는다.
 *
 * **×1 줄은 `balance.perf.ts`의 `walking` 표와 같은 판이다**(같은 씨앗 60개 · 같은 세 사람 ·
 * 같은 기본 맵). 선 안 112/180판이 두 자에서 같게 나온다 — 이 자가 게임을 제대로 잡고
 * 있다는 뜻이고, 배를 곱한 줄을 그 줄과 나란히 읽을 수 있다는 뜻이다.
 *
 * **넷째 묶음은 반지름이 아니라 자다**(`×1(딴 씨앗)` · 세션 87이 얹었다). 배를 ×1로 둔 채
 * **씨앗만 예순 개를 갈아 끼운 줄**이고, 그것이 이 표의 **흔들림 바닥**이다. 세션 86이
 * `layout.perf.ts`에서 세운 규칙을 이 표에도 세운 것인데 — **60판짜리 표에서 값을 견줄 때는
 * 같은 값을 딴 씨앗 블록으로 한 번 더 돌린 줄을 함께 세워라** — 세션 85가 이 표를 처음 쟀을
 * 때는 그 줄이 없었다. 아래 ④가 그 줄로 위 세 답을 다시 판별한다. **셋 다 살아남았고,
 * 이제는 폭이 아니라 폭÷바닥으로 적혀 있다**(0.4 · 0.5 · **10.8**).
 * 바닥이 사람마다 다르다는 것도 그 줄이 알려 준다 — 아무거나 19초 · 화력 11초 · 보조 6초.
 *
 * **선 안 판 수는 바닥 위에서 읽지 마라.** 같은 ×1이 씨앗만 갈아 끼우면 112 → 130/180판이다.
 * 이 표에서 줄을 세울 수 있는 칸은 중앙값이고, 선 안 수는 그 중앙값을 거드는 값이다.
 */
const SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + i);

/**
 * **흔들림 바닥을 재는 딴 씨앗 예순 개.** 위와 겹치지 않게 뒤에 이어 붙인다.
 * `layout.perf.ts`(세션 86)의 넷째 줄과 같은 자다 — 그 자가 없었을 때 세션 86은
 * 판 길이가 226 / 250 / 264초로 벌어지는 것을 **배치가 가른 것으로 읽을 뻔했다.**
 * 같은 배치를 딴 씨앗으로 돌리면 226 → 257초였으니, 그 폭은 잰 것이 아니라 구른 것이다.
 */
const OTHER_SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + 120 + i);

/** `tests/progression.test.ts`·`balance.perf.ts`와 같은 선. 세 자가 같은 자를 써야 견줄 수 있다. */
const SHORTEST = 150;
const LONGEST = 330;

/** `balance.perf.ts`의 세 사람 그대로. 한 표가 가르는 것은 오직 반지름이다. */
const PEOPLE: readonly { name: string; choose: Chooser }[] = [
  { name: '아무거나', choose: takeAny },
  { name: '화력 먼저', choose: preferPower },
  { name: '보조 먼저', choose: preferSupport },
];

/**
 * 재는 배. **좁히는 쪽을 ×0.9까지만 보는 이유**는 그 한 칸에서 이미 답이 나오기 때문이다
 * (아래 ①). 넓히는 쪽은 ×1.25가 3~5분 천장에 닿기 직전 자리다.
 */
const SCALES = [0.9, 1, 1.25] as const;

interface Scaled {
  scale: number;
  /** 표에 찍는 이름. 흔들림 바닥 줄만 배가 같고 씨앗이 다르다. */
  label: string;
  rows: { name: string; rows: MatchResult[] }[];
}

function runAt(scale: number, seeds: readonly number[] = SEEDS, label = `×${scale}`): Scaled {
  const baseRadius = ARENA.radius;
  const baseSpawn = REINFORCE.spawnRadius;
  const mul = (v: number): number => Number((v * scale).toFixed(3));
  try {
    (ARENA as { radius: number }).radius = mul(baseRadius);
    (REINFORCE as { spawnRadius: number }).spawnRadius = mul(baseSpawn);
    const map = {
      ...DEFAULT_MAP,
      enemies: DEFAULT_MAP.enemies.map((e) => ({ ...e, x: mul(e.x), y: mul(e.y) })),
    };
    return {
      scale,
      label,
      rows: PEOPLE.map((p) => ({
        name: p.name,
        rows: seeds.map((seed) => playMatch(seed, 600, walkToNearestCore, p.choose, map)),
      })),
    };
  } finally {
    (ARENA as { radius: number }).radius = baseRadius;
    (REINFORCE as { spawnRadius: number }).spawnRadius = baseSpawn;
  }
}

const inRange = (rows: readonly MatchResult[]): number =>
  rows.filter((r) => r.elapsed >= SHORTEST && r.elapsed <= LONGEST).length;

function line(name: string, rows: readonly MatchResult[]): string {
  const lens = rows.map((r) => r.elapsed).sort((a, b) => a - b);
  const pad = (n: number, w = 3): string => n.toFixed(0).padStart(w, ' ');
  return (
    `    ${name.padEnd(9, ' ')} 중앙 ${pad(median(lens))}초 · ` +
    `p5 ${pad(quantile(lens, 0.05))} · p90 ${pad(quantile(lens, 0.9))} · ` +
    `선 안 ${pad(inRange(rows), 2)}/${rows.length}판 · ` +
    `Lv${median(rows.map((r) => r.level)).toFixed(0)} · ` +
    `${median(rows.map((r) => r.kills)).toFixed(0)}처치 · ` +
    `첫 피격 ${median(rows.map((r) => r.firstHit)).toFixed(0)}초`
  );
}

const medianOf = (t: Scaled, name: string): number =>
  median((t.rows.find((r) => r.name === name)?.rows ?? []).map((r) => r.elapsed));

describe(`아레나 반지름 — 세 크기 × 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  it('반지름은 한쪽으로만 도는 손잡이다', () => {
    const tables = SCALES.map((scale) => runAt(scale));
    /** 배는 그대로 두고 씨앗만 갈아 끼운 줄. **이 줄은 반지름이 아니라 자다.** */
    const floor = runAt(1, OTHER_SEEDS, '×1(딴 씨앗)');

    console.log(
      [
        '',
        `  적의 사거리 ${ENEMY.fireRange}m는 함께 곱하지 않는다 — 이 표가 재는 것이 그 차다`,
        ...[...tables, floor].flatMap((t) => [
          '',
          `  반지름 ${(ARENA.radius * t.scale).toFixed(1)}m (${t.label}) · ` +
            `증원 고리 ${(REINFORCE.spawnRadius * t.scale).toFixed(1)}m`,
          ...t.rows.map((r) => line(r.name, r.rows)),
          line('모두', t.rows.flatMap((r) => r.rows)),
        ]),
        '',
      ].join('\n'),
    );

    const narrow = tables[0] as Scaled;
    const base = tables[1] as Scaled;
    const wide = tables[2] as Scaled;

    // ① **좁히는 쪽은 닫혀 있다. 10%만 좁혀도 반대쪽 끝 한 사람이 선 밑으로 떨어진다.**
    // 실측 중앙값(보조를 먼저 고르는 사람 · `balance.perf.ts`의 ②가 보는 그 사람):
    //   | 배 | ×0.75 | ×0.85 | **×0.9** | **×1** | ×1.15 | ×1.25 |
    //   |---|---|---|---|---|---|---|
    //   | 보조 먼저 | 75초 | 88 | **93** | **122** | 146 | 158 |
    // 반지름을 10% 줄이는데 그 사람의 판은 24% 짧아진다. 까닭은 적의 사거리다 —
    // `ENEMY.fireRange`(15m)는 아레나와 함께 줄지 않으므로, 반지름을 좁히면
    // **"사거리 밖"이라는 자리가 아레나에서 사라진다.** 그 자리를 필요로 하는 사람은
    // 셋 중 하나뿐이고(아래 ②), 그래서 이 손잡이는 그 사람만 깎는다.
    //
    // **이 선이 우는 날 반지름 손잡이가 열린다.** 적의 사거리가 아레나를 따라가게 되면
    // (또는 좁은 아레나에서 적이 덜 쏘게 되면) 여기가 먼저 알려 준다.
    expect(
      medianOf(narrow, '보조 먼저'),
      `×0.9에서 보조를 먼저 고르는 사람 ${medianOf(narrow, '보조 먼저').toFixed(0)}초`,
    ).toBeLessThan(120);

    // ② **그런데 잘 고르는 두 사람은 거의 안 움직인다.** ×0.9에서 ×1.25까지 세 배 반의
    // 넓이를 오가는 동안 화력을 먼저 고르는 사람은 272 → 266초다(실측 ×0.75에서도 258초).
    // **그 6초는 흔들림 바닥 11초의 절반이다**(아래 ④) — 곧 "거의"가 아니라 제자리다.
    // 곧 반지름이 파는 것은 **난이도 전체가 아니라 아래쪽 꼬리 하나**다.
    // 이 두 줄이 3~5분 안에 머무는 한, 반지름은 "맵마다 다른 게임"을 만들지 못한다 —
    // 고르는 화면에서 두 맵을 갈라 줄 만한 차이가 나는 것은 못 고르는 사람에게뿐이다.
    for (const t of [narrow, wide]) {
      for (const name of ['아무거나', '화력 먼저']) {
        const m = medianOf(t, name);
        expect(m, `×${t.scale}의 ${name} ${m.toFixed(0)}초`).toBeGreaterThan(SHORTEST);
        expect(m, `×${t.scale}의 ${name} ${m.toFixed(0)}초`).toBeLessThan(LONGEST);
      }
    }

    // ③ 넓히는 쪽은 열려 있다 — 그러나 그 맵이 파는 것은 "더 쉽다"뿐이다.
    // 넓힐수록 반대쪽 끝 한 사람만 살아난다(93 → 122 → 158초). 첫 피격도 4 → 5 → 7초로
    // 늦어지는데, 그것은 적이 걸어오는 데 드는 시간이지 새 규칙이 아니다.
    expect(medianOf(wide, '보조 먼저')).toBeGreaterThan(medianOf(base, '보조 먼저'));
    expect(medianOf(base, '보조 먼저')).toBeGreaterThan(medianOf(narrow, '보조 먼저'));

    // ④ **위 세 줄이 잰 것인지 구른 것인지를 여기서 가른다**(세션 87 · 규칙은 세션 86이 세웠다).
    // `floor`는 반지름이 아니라 **씨앗만 갈아 끼운 줄**이다(배는 ×1 그대로). 그 줄과 ×1 줄의
    // 차가 이 자의 **흔들림 바닥**이고, 배들 사이의 폭은 그 바닥의 갑절을 넘어야 잰 것이 된다.
    //
    // **실측 — 바닥과 폭**(사람마다 바닥이 다르다는 것이 이 줄의 또 하나의 답이다):
    //   | 사람 | ×1 vs 딴 씨앗 = 바닥 | ×0.9~×1.25 폭 | 폭 ÷ 바닥 |
    //   |---|---|---|---|
    //   | 아무거나 | 226 vs 245 = **19초** | 246~254 = 8초 | **0.4** |
    //   | 화력 먼저 | 269 vs 280 = **11초** | 266~272 = 6초 | **0.5** |
    //   | **보조 먼저** | 122 vs 128 = **6초** | 93~158 = 65초 | **10.8** |
    //
    // 곧 ②의 "잘 고르는 두 사람은 제자리다"는 **바닥 안에서의 제자리**이고(폭이 바닥의 절반),
    // ①·③이 읽은 것은 **바닥의 열 배짜리 신호**다. 세션 85의 표가 ×0.75에서 224초,
    // ×0.9에서 246초로 되짚어 올라갔던 것도 이 줄이 설명한다 — 그 20초는 바닥 19초 안이다.
    const FLOOR_MARGIN = 2;
    for (const { name } of PEOPLE) {
      const noise = Math.abs(medianOf(base, name) - medianOf(floor, name));
      const signal = Math.abs(medianOf(wide, name) - medianOf(narrow, name));
      const bar = Math.max(noise, 1) * FLOOR_MARGIN;
      const note =
        `${name} · ×0.9~×1.25 폭 ${signal.toFixed(0)}초 · ` +
        `흔들림 바닥 ${medianOf(base, name).toFixed(0)} vs ${medianOf(floor, name).toFixed(0)}초`;
      // 반대쪽 끝 한 사람만 바닥을 넘는다 — 그것이 ①·③이 읽은 신호다.
      // 이 선이 우는 날은 그 신호가 잡음으로 내려앉은 날이고, 그때 ①·③은 더 이상 답이 아니다.
      if (name === '보조 먼저') expect(signal, note).toBeGreaterThan(bar);
      // 잘 고르는 두 사람은 바닥 안에 머문다 — ②의 "제자리"가 정말 제자리라는 뜻이다.
      // **"제자리"를 바닥보다 좁게 말할 수는 없다.** 이 선의 헐거움은 자의 헐거움 그대로다.
      else expect(signal, note).toBeLessThan(bar);
    }
  });
});
