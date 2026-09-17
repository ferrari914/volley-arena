import { describe, expect, it } from 'vitest';
import { ARENA, ENEMY, REINFORCE } from '../../src/data/config';
import { DEFAULT_MAP } from '../../src/data/maps';
import { LOAD_ENEMIES } from '../support/loadScene';
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
 * **증원이 무엇을 흔드는가** (DESIGN 10번 · 세션 88).
 *
 * 왜 여기에 있나: 맵이 흔들 손잡이 셋이 차례로 닫혔다 — **가림**(세션 72·77·78) ·
 * **반지름**(세션 85 · `radius.perf.ts`) · **배치**(세션 86 · `layout.perf.ts`).
 * STATUS가 여덟째 맵을 세우려는 사람에게 남긴 새 후보 셋 중 하나가 이것이다:
 * **"증원을 맵마다 가른다(고리·간격·표). 배치와 달리 증원은 판 내내 살아 있는 값이라
 * 지평선이 없다. 대신 한 판 길이를 가장 먼저 흔든다."** 이 자가 그 값을 잰다.
 *
 * **재는 법: 증원 손잡이 하나씩만 갈고 나머지는 전부 그대로 둔다.**
 * `REINFORCE`를 실행 중에 고쳤다 `finally`로 되돌린다 — `World`가 매 프레임 읽는 값이라
 * 그렇게 할 수 있다(`radius.perf.ts`가 `ARENA.radius`에 쓰는 방법 그대로).
 * `vitest.perf.config.ts`가 `fileParallelism: false`라 다른 파일과 겹치지 않는다.
 * **맵이 증원을 가를 수 있게 되면 이 손장난은 `WorldOptions`로 옮겨야 하고,
 * 지금 그렇게 하지 않기로 한 근거가 아래 표다.**
 *
 * **표(`REINFORCE.order`)는 안 쟀다.** 그것은 "얼마나 오는가"가 아니라 **"무엇이 오는가"**라,
 * STATUS의 후보 (가)(맵마다 다른 적 종류)와 같은 물음이고 밸런스 표를 통째로 옮긴다
 * (세션 84가 그 자리에 "이 표를 건드리지 않는다"를 근거와 함께 적어 두었다 —
 * `config.ts`의 `order` 주석). 이 자가 재는 것은 **시각과 자리**뿐이다.
 *
 * **실측 — 세 사람 × 씨앗 예순 개 × 빈 뜰**(한 판 중앙값, 초):
 * | 증원 | 아무거나 | 화력 먼저 | **보조 먼저** | p90(화력) |
 * |---|---|---|---|---|
 * | **지금**(첫 120 · 28초 · 고리 22m) | 226 | 269 | **122** | 345 |
 * | 빠르게(간격 20초) | 220 | 260 | **122** | 311 |
 * | 느리게(간격 40초) | 240 | 293 | **122** | 373 |
 * | **늦게(첫 증원 180초)** | **264** | **319** | **122** | **387** |
 * | 고리 멀리(25m) | 236 | 286 | **122** | 342 |
 * | **지금(딴 씨앗)** = 흔들림 바닥 | 240 | 285 | 121 | 353 |
 * | **폭 ÷ 바닥** | 44÷14 = **3.1** | 59÷16 = **3.7** | 0÷1 = **0** |
 *
 * **답 ①: 증원은 흔들림 바닥을 넘는 첫 손잡이다.** 가림·반지름·배치는 잘 고르는 두 사람을
 * 바닥 안에서만 움직였다(배치 폭÷바닥 1 아래 · 반지름 0.4와 0.5). 증원은 그 둘을
 * **바닥의 세 배 넘게** 민다. 곧 **맵이 돌릴 수 있는 손잡이가 처음으로 하나 나왔다.**
 *
 * **답 ②: 그런데 증원은 아래쪽 꼬리에 닿지 못한다 — 보조를 먼저 고르는 사람이 122초로
 * 다섯 줄 전부 같다(폭 0초).** 까닭은 세는 것이 아니라 시계다: **첫 증원이 120초에 오는데
 * 그 사람의 판이 122초다.** 손잡이를 어느 쪽으로 돌려도 그 사람은 증원을 보기 전에 쓰러진다.
 * **이것이 반지름의 정확한 거울이다** — 반지름은 그 사람만 갈랐고(폭÷바닥 10.8) 잘 고르는
 * 둘은 제자리였다. 증원은 잘 고르는 둘을 가르고 그 사람은 제자리다.
 * 곧 **두 손잡이를 겹쳐도 "맵마다 다른 게임"이 되지는 않는다. 서로 다른 끝을 잡고 있다.**
 *
 * **답 ③: 돌릴 수 있는 쪽은 한쪽뿐이다 — 조이는 쪽이다.** 위 표에서 판을 늘리는 세 줄은
 * 전부 3~5분 천장으로 간다(느리게 293 · 고리 멀리 286 · **늦게 319**, 선은 330초).
 * **늦게 줄은 천장 11초 밑이다** — 첫 증원을 60초 늦추는 것만으로 거기까지 간다.
 * 반대로 조이는 쪽(빠르게)은 중앙값이 바닥 안에서 움직이는 대신 **위쪽 꼬리를 조인다**
 * (화력 먼저 p90 345 → 311초). 곧 **증원으로 갈린 두 맵은 "한쪽이 더 길다"가 아니라
 * "한쪽이 덜 늘어진다"로 갈린다** — 맵 고르기 화면에 적을 수 있는 말이 아니다.
 *
 * **답 ④: 무겁게 하는 쪽으로는 자리가 한 칸 남았다**(아래 ①이 판을 안 돌리고 지킨다).
 * 처음 배치 일곱 + `maxExtra` 열둘 = **열아홉**이고, DESIGN 품질 기준이 못 박은 부하 선이
 * **스물**이다(`tests/support/loadScene.ts`). 간격을 줄이는 쪽은 자리를 빨리 쓸 뿐이라
 * (`config.ts`의 `interval` 주석: "혼자 옮기면 안 된다"), **자리를 늘려 받아 내려면
 * 그 선이 먼저 걸린다.**
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/reinforce.perf.ts
 */
const SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + i);

/**
 * **흔들림 바닥을 재는 딴 씨앗 예순 개**(세션 86이 세우고 87이 규칙으로 올린 줄).
 * `radius.perf.ts`가 +120을 썼으므로 겹치지 않게 +180에서 시작한다.
 */
const OTHER_SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + 180 + i);

/** `tests/progression.test.ts`·`balance.perf.ts`와 같은 선. 세 자가 같은 자를 써야 견줄 수 있다. */
const SHORTEST = 150;
const LONGEST = 330;

/** `balance.perf.ts`·`radius.perf.ts`의 세 사람 그대로. 한 표가 가르는 것은 오직 증원이다. */
const PEOPLE: readonly { name: string; choose: Chooser }[] = [
  { name: '아무거나', choose: takeAny },
  { name: '화력 먼저', choose: preferPower },
  { name: '보조 먼저', choose: preferSupport },
];

interface Knob {
  label: string;
  firstDelay?: number;
  interval?: number;
  spawnRadius?: number;
  /** 흔들림 바닥 줄만 손잡이가 같고 씨앗이 다르다. */
  seeds?: readonly number[];
}

interface Table {
  label: string;
  rows: { name: string; rows: MatchResult[] }[];
}

function runWith(knob: Knob): Table {
  const base = {
    firstDelay: REINFORCE.firstDelay,
    interval: REINFORCE.interval,
    spawnRadius: REINFORCE.spawnRadius,
  };
  const live = REINFORCE as { firstDelay: number; interval: number; spawnRadius: number };
  try {
    live.firstDelay = knob.firstDelay ?? base.firstDelay;
    live.interval = knob.interval ?? base.interval;
    live.spawnRadius = knob.spawnRadius ?? base.spawnRadius;
    return {
      label: knob.label,
      rows: PEOPLE.map((p) => ({
        name: p.name,
        rows: (knob.seeds ?? SEEDS).map((seed) =>
          playMatch(seed, 600, walkToNearestCore, p.choose, DEFAULT_MAP),
        ),
      })),
    };
  } finally {
    live.firstDelay = base.firstDelay;
    live.interval = base.interval;
    live.spawnRadius = base.spawnRadius;
  }
}

const NOW = '지금';
const FASTER = '빠르게';
const SLOWER = '느리게';
const LATER = '늦게';
const WIDER = '고리 멀리';
const FLOOR = '지금(딴 씨앗)';

/** 고리를 넓힌 값. 아레나 벽에 몸이 닿기 직전이다(26 − 0.7 = 25.3m). */
const WIDE_RING = 25;

const KNOBS: readonly Knob[] = [
  { label: NOW },
  /** 간격만 줄인다. 자리 열둘을 그만큼 빨리 쓴다 — 마지막 증원이 428 → 340초에 온다. */
  { label: FASTER, interval: 20 },
  /** 간격만 늘린다. 마지막 증원이 560초라 거의 모든 판 밖이다. */
  { label: SLOWER, interval: 40 },
  /** 첫 증원만 60초 늦춘다. 뒤의 열한 자리가 통째로 밀린다. */
  { label: LATER, firstDelay: 180 },
  /** 자리는 그대로 두고 **걸어 들어오는 거리**만 늘린다. */
  { label: WIDER, spawnRadius: WIDE_RING },
  { label: FLOOR, seeds: OTHER_SEEDS },
];

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

const medianOf = (t: Table, name: string): number =>
  median((t.rows.find((r) => r.name === name)?.rows ?? []).map((r) => r.elapsed));

describe(`증원 — 손잡이 다섯 + 흔들림 바닥 × 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  /**
   * **판을 안 돌리는 공짜 검사.** 위 표를 읽기 전에 두 가지를 본다 —
   * 넓힌 고리가 정말로 아레나 안이고 여전히 사람에게서 떨어져 서는지(아니면 그 줄은
   * 아무것도 안 흔든 줄이거나 벽에 잘린 줄이다), 그리고 **증원 자리가 부하 선 안인지**다.
   * 뒤엣것이 답 ④이고, 증원을 무겁게 해서 맵을 가르려는 사람이 가장 먼저 걸릴 선이다.
   */
  it('넓힌 고리가 아레나 안이고, 증원 자리는 부하 선 스물 안이다', () => {
    expect(WIDE_RING, '넓힌 고리').toBeLessThan(ARENA.radius - ENEMY.radius);
    expect(WIDE_RING, '넓힌 고리').toBeGreaterThan(REINFORCE.minPlayerDistance);

    // 처음 배치 일곱 + 자리 열둘 = 열아홉. DESIGN 품질 기준의 부하 상황이 스물이다.
    // **간격을 줄이는 쪽은 자리를 빨리 쓸 뿐이므로**(`config.ts`의 `interval` 주석),
    // 증원을 정말로 무겁게 하려면 이 선을 넘어야 한다 — 남은 것은 한 칸이다.
    const most = DEFAULT_MAP.enemies.length + REINFORCE.maxExtra;
    expect(most, `한 판에 설 수 있는 적 ${most}마리`).toBeLessThanOrEqual(LOAD_ENEMIES);
  });

  it('증원은 바닥을 넘는 첫 손잡이지만, 아래쪽 꼬리에는 닿지 못한다', () => {
    const tables = KNOBS.map(runWith);

    console.log(
      [
        '',
        `  빈 뜰 · 아레나 ${ARENA.radius}m · 처음 배치 ${DEFAULT_MAP.enemies.length}마리 · ` +
          `증원 자리 ${REINFORCE.maxExtra}(부하 선 ${LOAD_ENEMIES}) · 적 사거리 ${ENEMY.fireRange}m`,
        ...tables.flatMap((t) => [
          '',
          `  증원 ${t.label}`,
          ...t.rows.map((r) => line(r.name, r.rows)),
          line('모두', t.rows.flatMap((r) => r.rows)),
        ]),
        '',
      ].join('\n'),
    );

    const by = (label: string): Table =>
      tables.find((t) => t.label === label) ?? (tables[0] as Table);
    const knobsOnly = [NOW, FASTER, SLOWER, LATER, WIDER].map(by);

    /** 손잡이 다섯 줄이 벌어지는 폭(초). 같은 씨앗이라 씨앗이 구른 몫이 없다. */
    const width = (name: string): number => {
      const values = knobsOnly.map((t) => medianOf(t, name));
      return Math.max(...values) - Math.min(...values);
    };
    /** 손잡이는 그대로 두고 씨앗만 갈아 끼웠을 때의 폭(초) — **이 표의 흔들림 바닥**이다. */
    const floor = (name: string): number =>
      Math.abs(medianOf(by(NOW), name) - medianOf(by(FLOOR), name));

    // ① **증원은 흔들림 바닥을 넘는다. 맵의 손잡이 중 이것이 처음이다.**
    //    실측(폭 ÷ 바닥): 아무거나 44÷14 = **3.1** · 화력 먼저 59÷16 = **3.7**.
    //    견줄 것 — 배치는 1 아래(`layout.perf.ts`의 ②), 반지름은 이 두 사람에게서
    //    0.4와 0.5였다(`radius.perf.ts`의 ④). **이 선이 우는 날 증원도 닫힌 것이고,
    //    그러면 여덟째 맵은 남은 후보 둘(적 종류 · 움직이는 가림)로만 세울 수 있다.**
    for (const name of ['아무거나', '화력 먼저']) {
      const ratio = width(name) / floor(name);
      expect(
        ratio,
        `${name}의 폭 ${width(name).toFixed(0)}초 ÷ 바닥 ${floor(name).toFixed(0)}초`,
      ).toBeGreaterThan(2);
    }

    // ② **그런데 아래쪽 꼬리는 못 건드린다 — 보조를 먼저 고르는 사람이 다섯 줄 다 122초다.**
    //    이 줄이 재는 것은 그 사람이 아니라 **시계**다: 첫 증원이 120초에 오는데 그 사람의
    //    판이 그 언저리에서 끝나므로, 손잡이를 어느 쪽으로 돌려도 볼 일이 없다.
    //    그래서 폭이 아니라 **까닭**을 못 박는다 — 그 사람의 판이 첫 증원 + 한 칸보다
    //    길어지는 날 증원이 그 사람에게도 닿기 시작하고, 그때 이 표를 다시 읽어야 한다.
    const weak = medianOf(by(NOW), '보조 먼저');
    expect(weak, `보조를 먼저 고르는 사람 ${weak.toFixed(0)}초`).toBeLessThan(
      REINFORCE.firstDelay + REINFORCE.interval,
    );
    //    증상 쪽도 함께 잡아 둔다. 바닥이 1초라 바닥으로는 못 재므로(0÷1은 자가 아니다)
    //    **잘 고르는 사람의 폭에 견준다** — 실측 0초 대 44초다.
    expect(
      width('보조 먼저'),
      `보조 먼저 폭 ${width('보조 먼저').toFixed(0)}초 · 아무거나 폭 ${width('아무거나').toFixed(0)}초`,
    ).toBeLessThan(width('아무거나') * 0.25);

    // ③ **돌릴 수 있는 쪽은 조이는 쪽뿐이다.** 늘리는 쪽은 첫 증원을 60초 늦추는 것만으로
    //    3~5분 천장에 붙는다(화력 먼저 269 → **319초** · 선 330). 남은 여유가 **11초**다.
    //    이 두 줄이 함께 말하는 것: 늦추는 것은 확실히 듣지만(바닥 16초의 세 배),
    //    **한 칸만 더 늦추면 게임이 3~5분을 벗어난다.**
    const later = medianOf(by(LATER), '화력 먼저');
    const now = medianOf(by(NOW), '화력 먼저');
    expect(later, `늦게 ${later.toFixed(0)}초 · 지금 ${now.toFixed(0)}초`).toBeGreaterThan(
      now + floor('화력 먼저') * 2,
    );
    expect(later, `늦게 ${later.toFixed(0)}초 (천장 ${LONGEST}초)`).toBeLessThan(LONGEST);

    // ④ 그래도 다섯 손잡이 모두 잘 고르는 두 사람에게는 3~5분 안이다. ①이 "차이가 있다"를
    //    재는 자라면, 이 줄은 "그 차이가 선 안에서의 차이인지"를 재는 자다
    //    (`layout.perf.ts`의 ③과 같은 자리). **보조를 먼저 고르는 사람은 여기서 뺀다** —
    //    그 사람의 판이 선 밑인 것은 그 사람의 정의이지 증원의 탓이 아니다
    //    (`balance.perf.ts`의 `inWindow: false`).
    for (const t of [...knobsOnly, by(FLOOR)]) {
      for (const name of ['아무거나', '화력 먼저']) {
        const m = medianOf(t, name);
        expect(m, `${t.label}의 ${name} ${m.toFixed(0)}초`).toBeGreaterThan(SHORTEST);
        expect(m, `${t.label}의 ${name} ${m.toFixed(0)}초`).toBeLessThan(LONGEST);
      }
    }
  });
});
