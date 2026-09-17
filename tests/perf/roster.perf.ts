import { describe, expect, it } from 'vitest';
import { ARENA, REINFORCE } from '../../src/data/config';
import { DEFAULT_MAP } from '../../src/data/maps';
import type { ArenaMap } from '../../src/data/maps';
import type { EnemyKind, EnemySpawn } from '../../src/entities/types';
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
 * **맵마다 다른 적 종류가 무엇을 흔드는가** (DESIGN 10번 · 세션 89).
 *
 * 왜 여기에 있나: 맵이 흔들 손잡이 넷이 차례로 닫혔다 — **가림**(세션 72·77·78) ·
 * **반지름**(85 · `radius.perf.ts`) · **배치**(86 · `layout.perf.ts`) ·
 * **증원**(88 · `reinforce.perf.ts`). STATUS가 남긴 후보 둘 중 하나가 이것이고,
 * `data/maps.ts`의 배치 주석이 세션 86의 표 아래에 손수 적어 둔 자리이기도 하다 —
 * **"이 표는 '자리를 옮기는 것'을 닫았지 '무엇을 세우는가'를 닫지 않았다."**
 *
 * **이 손잡이에는 지평선이 없다. 배치와 갈리는 자리가 거기다.** 쓰러진 적은 3.6초 뒤
 * **같은 종류로** 다시 선다(`World.updateEnemies`는 같은 `Enemy`를 다시 세운다 ·
 * `ENEMY.respawnDelay`). 자리는 플레이어 둘레 고리로 옮겨 가지만(`pickRespawnSpot`)
 * **종류는 판이 끝날 때까지 남는다.** 그래서 배치가 판의 6%(15초)에만 닿았던 것과 달리,
 * 무리는 처음부터 끝까지 듣는다.
 *
 * **재는 법: 자리는 한 점도 안 옮기고 종류만 갈아 끼운다**(`roster` · 아래 공짜 검사가
 * 일곱 자리가 그대로인지를 매번 확인한다). 맵은 빈 뜰 하나뿐이라 기둥이 끼어들지 않는다.
 * `ArenaMap`을 한 장 만들어 `playMatch`에 그대로 넘기므로 **실행 중에 고치는 값이 없다** —
 * 여덟째 맵이 정말로 서면 코드 쪽은 이 줄 하나가 전부라는 뜻이기도 하다.
 *
 * **실측 — 세 사람 × 씨앗 예순 개 × 빈 뜰**(한 판 중앙값, 초):
 * | 처음 서는 일곱 | 아무거나 | 화력 먼저 | **보조 먼저**(선 120) | 화력÷보조 |
 * |---|---|---|---|---|
 * | **지금**(여섯 종류) | 226 | 269 | **122** | 2.22 |
 * | 활잡이만 | 177 | 168 | **155** | **1.09** |
 * | 방패병만 | 162 | 182 | **125** | 1.46 |
 * | 돌진형만 | 159 | 246 | **41** | **6.02** |
 * | **한 칸만 붙는 쪽으로**(활잡이 하나 → 돌진형) | 247 | 293 | **86** | 3.39 |
 * | 붙는 쪽으로(활잡이 둘 → 돌진형) | 232 | 297 | **60** | 4.93 |
 * | 떨어지는 쪽으로(활잡이 둘 → 투석병) | 315 | **375** | 160 | 2.35 |
 * | *지금 · 딴 씨앗 60개(흔들림 바닥)* | *247* | *285* | *125* | *2.29* |
 * | **폭 ÷ 바닥** | 156÷21 = **7.4** | 207÷16 = **12.9** | 119÷3 = **39.7** |
 *
 * **답 ①: 무리는 세 사람 모두에게 바닥을 넘는 첫 손잡이다.** 앞의 넷은 늘 한쪽 끝만
 * 잡았다 — 반지름은 아래쪽 꼬리만(폭÷바닥 10.8 · 잘 고르는 둘은 0.4와 0.5),
 * 증원은 잘 고르는 둘만(3.1 · 3.7 · 꼬리는 0), 배치는 아무 데도(1 아래).
 * 무리는 **셋 다** 넘고, 꼬리에서는 바닥의 **마흔 배**다.
 *
 * **답 ②: 그런데 너무 크게 넘어서 겨눌 수가 없다. 이 손잡이에는 눈금이 일곱 칸뿐이다.**
 * 가장 작게 돌리는 법이 **일곱 중 한 칸**을 가는 것인데, 그 한 칸에 보조를 먼저 고르는
 * 사람이 **122 → 86초**다(`balance.perf.ts` ②의 선 120). 까닭은 무리가 센 것만이
 * 아니다 — **지금 무리가 이미 그 선의 벼랑 끝에 서 있다**: 122초는 선에서 **2초** 위이고,
 * 그 2초는 흔들림 바닥(3초)보다도 얇다. 곧 **판을 조금이라도 무겁게 하는 무리는 전부
 * 선 밑으로 떨어진다**(한 칸 86 · 두 칸 60 · 돌진형만 41초).
 *
 * **답 ③: 반대로 돌리면 천장이 먼저 걸린다.** 가볍게 하는 쪽으로 두 칸을 돌리면
 * (활잡이 둘 → 투석병) 꼬리는 살아나지만(160초) **화력을 먼저 고르는 사람이 375초**로
 * 3~5분 천장(330초)을 넘는다. **한 칸만 돌려도 마찬가지다** — 그 줄은 이 표에 없지만
 * 세션 89가 같은 자로 따로 재 두었다(활잡이 하나 → 투석병 · 화력 먼저 **330초** · 선 안 30/60).
 * 곧 **양쪽 다 한 칸이 이미 한 칸 넘게 간다.**
 *
 * **답 ④: 그래서 선 안에 남는 무리는 사람 사이를 좁히는 무리뿐이다.** 셋 다 선 안인 것은
 * `지금` 말고 **활잡이만(비 1.09) · 방패병만(1.46)** 둘인데, 둘 다 **한 종류만 세운 무리**다.
 * 곧 이 손잡이가 실제로 여는 축은 "판이 얼마나 긴가"가 아니라 **"고른 카드가 얼마나
 * 중요한가"**이고(1.09에서 6.02까지), **게임이 허락하는 쪽은 "덜 중요하다" 쪽뿐이다.**
 * 그런데 `data/maps.ts`가 표준 배치 머리말에 적어 둔 것이 정확히 그 반대다 —
 * **"활잡이만 있으면 거리를 벌리는 것 하나로 모든 위협이 풀린다. 섞어야 요구가 여섯이 된다."**
 * **곧 종류로 가른 여덟째 맵은 설 수는 있지만, 서는 순간 요구가 하나로 줄어든 맵이 된다.**
 *
 * **이 표를 다시 읽어야 할 날: 보조를 먼저 고르는 사람의 판이 120초에서 멀어지는 날이다.**
 * 그 2초가 이 손잡이를 막고 있는 전부다 — 아래 ②가 그 까닭을 값으로 못 박는다.
 *
 *   npx vitest run --config vitest.perf.config.ts tests/perf/roster.perf.ts
 */
const SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + i);

/**
 * **흔들림 바닥을 재는 딴 씨앗 예순 개**(세션 86이 세우고 87이 규칙으로 올린 줄).
 * `layout`이 +60 · `radius`가 +120 · `reinforce`가 +180을 썼으므로 +240에서 시작한다.
 */
const OTHER_SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + 240 + i);

/** `tests/progression.test.ts`·`balance.perf.ts`와 같은 선. 여러 자가 같은 자를 써야 견줄 수 있다. */
const SHORTEST = 150;
const LONGEST = 330;

/**
 * **보조를 먼저 고르는 사람만 보는 선**(`balance.perf.ts`의 ② · `layout.perf.ts`의 ③).
 * 그 사람의 판이 선 밑인 것은 그 사람의 정의라, 3~5분 창 대신 이 선으로 잰다.
 */
const WEAK_FLOOR = 120;

/** `balance.perf.ts`·`radius.perf.ts`·`reinforce.perf.ts`의 세 사람 그대로. */
const PEOPLE: readonly { name: string; choose: Chooser }[] = [
  { name: '아무거나', choose: takeAny },
  { name: '화력 먼저', choose: preferPower },
  { name: '보조 먼저', choose: preferSupport },
];

const BASE = DEFAULT_MAP.enemies;

/**
 * 자리는 한 점도 안 옮기고 **종류만** 갈아 끼운다(세션 59부터의 "한 번에 하나만 흔든다").
 * 세션 86의 `layout.perf.ts`가 정확히 반대로 한 자다 — 거기는 종류를 두고 자리를 흔들었다.
 */
function roster(kinds: readonly EnemyKind[]): readonly EnemySpawn[] {
  return BASE.map((e, i) => ({ x: e.x, y: e.y, kind: kinds[i] ?? 'archer' }));
}

/** 일곱 자리를 한 종류로 채운다. 이 표의 양 끝(활잡이만 · 방패병만 · 돌진형만)이다. */
const fill = (kind: EnemyKind): readonly EnemyKind[] => BASE.map(() => kind);

interface Roster {
  label: string;
  /** 생략하면 지금 무리 그대로. 흔들림 바닥 줄만 무리가 같고 씨앗이 다르다. */
  kinds?: readonly EnemyKind[];
  seeds?: readonly number[];
}

const NOW = '지금';
const ARCHERS = '활잡이만';
const SHIELDS = '방패병만';
const CHARGERS = '돌진형만';
const ONE_STEP = '한 칸 붙는 쪽';
const CLOSER = '붙는 쪽으로';
const FARTHER = '떨어지는 쪽으로';
const FLOOR = '지금(딴 씨앗)';

/**
 * 지금 일곱은 `[폭탄병, 돌진형, 방패병, 활잡이, 활잡이, 약탈꾼, 투석병]`이다
 * (`data/maps.ts`의 `OPEN_LAYOUT`). 아래 세 줄은 **활잡이 자리(3·4번)만** 간다 —
 * 여섯 종류를 그대로 둔 채 무게만 기울이는, 여덟째 맵이 실제로 할 법한 돌림이다.
 */
const ROSTERS: readonly Roster[] = [
  { label: NOW },
  { label: ARCHERS, kinds: fill('archer') },
  { label: SHIELDS, kinds: fill('shield') },
  { label: CHARGERS, kinds: fill('charger') },
  /** **이 손잡이가 돌아가는 가장 작은 각**이다 — 일곱 중 한 칸. 답 ②가 보는 줄이다. */
  { label: ONE_STEP, kinds: ['bomber', 'charger', 'shield', 'charger', 'archer', 'looter', 'lobber'] },
  { label: CLOSER, kinds: ['bomber', 'charger', 'shield', 'charger', 'charger', 'looter', 'lobber'] },
  { label: FARTHER, kinds: ['bomber', 'charger', 'shield', 'lobber', 'lobber', 'looter', 'lobber'] },
  { label: FLOOR, seeds: OTHER_SEEDS },
];

interface Table {
  label: string;
  rows: { name: string; rows: MatchResult[] }[];
}

function runWith(r: Roster): Table {
  // 무리 하나가 맵 한 장이다. 실행 중에 고치는 값이 없으므로 `finally`로 되돌릴 것도 없다.
  const map: ArenaMap = r.kinds ? { ...DEFAULT_MAP, enemies: roster(r.kinds) } : DEFAULT_MAP;
  return {
    label: r.label,
    rows: PEOPLE.map((p) => ({
      name: p.name,
      rows: (r.seeds ?? SEEDS).map((seed) => playMatch(seed, 600, walkToNearestCore, p.choose, map)),
    })),
  };
}

const inRange = (rows: readonly MatchResult[]): number =>
  rows.filter((row) => row.elapsed >= SHORTEST && row.elapsed <= LONGEST).length;

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

/** 잘 고르는 사람과 못 고르는 사람의 판 길이 비. **고른 카드가 얼마나 중요한가**다. */
const gap = (t: Table): number => medianOf(t, '화력 먼저') / medianOf(t, '보조 먼저');

describe(`처음 서는 적의 종류 — 무리 일곱 + 흔들림 바닥 × 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  /**
   * **판을 안 돌리는 공짜 검사.** 위 표를 읽기 전에 두 가지를 본다 —
   * **일곱 자리가 한 점도 안 움직였는지**(움직였으면 이 표는 종류가 아니라 세션 86의
   * 배치를 다시 재고 있는 것이다), 그리고 **무리를 갈아도 부하 선 안인지**다.
   */
  it('무리를 갈아도 일곱 자리는 그대로이고, 부하 선 스물 안이다', () => {
    for (const r of ROSTERS) {
      const enemies = r.kinds ? roster(r.kinds) : BASE;
      expect(enemies.length, `${r.label}의 자리 수`).toBe(BASE.length);
      for (let i = 0; i < enemies.length; i += 1) {
        expect(enemies[i]?.x, `${r.label}의 ${i}번 자리 x`).toBe(BASE[i]?.x);
        expect(enemies[i]?.y, `${r.label}의 ${i}번 자리 y`).toBe(BASE[i]?.y);
      }
    }
    // 종류를 갈아도 몸의 수는 그대로다 — 처음 일곱 + 증원 열둘 = 열아홉(부하 선 스물).
    const most = BASE.length + REINFORCE.maxExtra;
    expect(most, `한 판에 설 수 있는 적 ${most}마리`).toBeLessThanOrEqual(LOAD_ENEMIES);

    // **무리 일곱이 서로 다른 무리인지.** 같은 줄이 둘 있으면 그 줄은 아무것도 안 흔든 줄이다.
    const seen = new Set<string>();
    for (const r of ROSTERS) {
      if (!r.kinds) continue;
      const key = r.kinds.join(',');
      expect(seen.has(key), `${r.label}이 앞 줄과 같은 무리다`).toBe(false);
      expect(key, `${r.label}이 지금 무리와 같다`).not.toBe(
        BASE.map((e) => e.kind ?? 'archer').join(','),
      );
      seen.add(key);
    }
  });

  /**
   * **이 자 하나가 `npm run perf`에서 가장 비싸다**(여덟 줄 × 세 사람 × 씨앗 예순 =
   * **1440판** · 한가한 기계에서 47초). 다음으로 비싼 `radius`가 36초다.
   *
   * **얼마나 걸리는지는 기계가 정한다. 세션 90이 같은 자를 두 번 돌려 그것을 봤다** —
   * 47초(CPU 98%)인 자가 다른 일과 CPU를 나눠 쓴 판에서는 **262초**였다
   * (CPU 16% · **계산량은 같다**: 두 판 모두 user 시간이 45초다). 그 판이
   * `vitest.perf.config.ts`의 옛 안전선 120초에 걸려 **표를 다 찍어 놓고 죽었고**,
   * 세션 89가 이 표를 남기고도 커밋을 못 한 까닭이 그것이다.
   *
   * **그래서 고친 자리는 이 줄이 아니라 그 설정 파일이다**(120 → 600초 · 까닭은 거기 적었다).
   * 처음에는 이 줄에만 한도를 따로 주려 했는데, 그러면 틀린 진단이 된다 —
   * 같은 배(5.5배)를 맞으면 `radius`도 200초라 옛 선을 넘는다. 곧 **120초는 이 자 하나의
   * 문제가 아니라 안전선을 한가한 기계에 맞춘 문제였다.**
   */
  it('무리는 세 사람 모두를 흔드는 첫 손잡이지만, 눈금이 일곱 칸뿐이라 겨눌 수 없다', () => {
    const tables = ROSTERS.map(runWith);

    console.log(
      [
        '',
        `  빈 뜰 · 아레나 ${ARENA.radius}m · 처음 배치 ${BASE.length}마리(자리 고정 · 종류만 간다)`,
        ...tables.flatMap((t) => [
          '',
          `  무리 ${t.label} — 화력÷보조 ${gap(t).toFixed(2)}`,
          ...t.rows.map((r) => line(r.name, r.rows)),
        ]),
        '',
      ].join('\n'),
    );

    const by = (label: string): Table =>
      tables.find((t) => t.label === label) ?? (tables[0] as Table);
    const rostersOnly = [NOW, ARCHERS, SHIELDS, CHARGERS, ONE_STEP, CLOSER, FARTHER].map(by);

    /** 무리 일곱 줄이 벌어지는 폭(초). 같은 씨앗이라 씨앗이 구른 몫이 없다. */
    const width = (name: string): number => {
      const values = rostersOnly.map((t) => medianOf(t, name));
      return Math.max(...values) - Math.min(...values);
    };
    /** 무리는 그대로 두고 씨앗만 갈아 끼웠을 때의 폭(초) — **이 표의 흔들림 바닥**이다. */
    const floor = (name: string): number =>
      Math.abs(medianOf(by(NOW), name) - medianOf(by(FLOOR), name));

    // ① **무리는 세 사람 모두에게 바닥을 넘는다. 맵의 손잡이 중 이것이 처음이다.**
    //    실측(폭 ÷ 바닥): 아무거나 156÷21 = **7.4** · 화력 먼저 207÷16 = **12.9** ·
    //    보조 먼저 119÷3 = **39.7**. 견줄 것 — 배치는 셋 다 1 아래(`layout.perf.ts` ②),
    //    반지름은 0.4 / 0.5 / 10.8(`radius.perf.ts` ④), 증원은 3.1 / 3.7 / 0
    //    (`reinforce.perf.ts` ①·②). **이 선이 우는 날 마지막 후보도 닫힌 것이고,
    //    그러면 여덟째 맵에 남는 것은 '움직이거나 사라지는 가림' 하나뿐이다.**
    for (const p of PEOPLE) {
      const ratio = width(p.name) / floor(p.name);
      expect(
        ratio,
        `${p.name}의 폭 ${width(p.name).toFixed(0)}초 ÷ 바닥 ${floor(p.name).toFixed(0)}초`,
      ).toBeGreaterThan(2);
    }

    // ② **가장 작게 돌려도 아래쪽 꼬리가 선 밑으로 떨어진다.** 이 손잡이의 눈금은
    //    일곱 칸뿐이고(자리가 일곱이다), 그 한 칸에 보조를 먼저 고르는 사람이 122 → 86초다.
    //    **까닭의 절반은 지금 무리가 이미 벼랑 끝에 서 있는 것이다** — 122초는 선에서
    //    2초 위이고 그 2초는 흔들림 바닥(3초)보다도 얇다. 여기가 이 자의 핵심이다:
    //    **그 여유가 바닥보다 두꺼워지는 날 이 손잡이가 처음으로 겨눌 수 있게 된다.**
    const weakNow = medianOf(by(NOW), '보조 먼저');
    const weakStep = medianOf(by(ONE_STEP), '보조 먼저');
    expect(weakNow, `지금 무리의 보조 먼저 ${weakNow.toFixed(0)}초`).toBeGreaterThan(WEAK_FLOOR);
    expect(
      weakNow - WEAK_FLOOR,
      `선 위 여유 ${(weakNow - WEAK_FLOOR).toFixed(0)}초 · 흔들림 바닥 ${floor('보조 먼저').toFixed(0)}초`,
    ).toBeLessThan(floor('보조 먼저') * 2);
    expect(weakStep, `한 칸만 돌린 무리의 보조 먼저 ${weakStep.toFixed(0)}초`).toBeLessThan(
      WEAK_FLOOR,
    );
    // 한 칸 줄이 무너뜨리는 것은 꼬리 하나뿐이다 — 잘 고르는 둘은 3~5분 안에 그대로 있다.
    // (그래서 ②는 "무리가 판을 망친다"가 아니라 "겨눌 수 없다"를 재는 자다.)
    for (const name of ['아무거나', '화력 먼저']) {
      const m = medianOf(by(ONE_STEP), name);
      expect(m, `한 칸만 돌린 무리의 ${name} ${m.toFixed(0)}초`).toBeGreaterThan(SHORTEST);
      expect(m, `한 칸만 돌린 무리의 ${name} ${m.toFixed(0)}초`).toBeLessThan(LONGEST);
    }

    // ③ **반대로 돌리면 천장이 먼저 걸린다.** 꼬리를 살리려고 가볍게 하는 쪽으로 두 칸을
    //    돌리면(활잡이 둘 → 투석병) 꼬리는 160초로 살아나지만 화력을 먼저 고르는 사람이
    //    375초가 되어 3~5분을 벗어난다. **곧 양쪽에 다 벼랑이 있다.**
    const farWeak = medianOf(by(FARTHER), '보조 먼저');
    const farPower = medianOf(by(FARTHER), '화력 먼저');
    expect(farWeak, `떨어지는 쪽 무리의 보조 먼저 ${farWeak.toFixed(0)}초`).toBeGreaterThan(
      WEAK_FLOOR,
    );
    expect(farPower, `떨어지는 쪽 무리의 화력 먼저 ${farPower.toFixed(0)}초`).toBeGreaterThan(
      LONGEST,
    );

    // ④ **선 안에 남는 무리는 사람 사이를 좁히는 무리뿐이다.** 셋 다 선 안인 것은 `지금`
    //    말고 활잡이만·방패병만 둘인데, 둘 다 **한 종류만 세운 무리**이고 화력÷보조가
    //    지금(2.22)보다 작다(1.09 · 1.46). 곧 이 손잡이가 실제로 여는 축은 판 길이가 아니라
    //    **"고른 카드가 얼마나 중요한가"**이고, 게임이 허락하는 쪽은 좁히는 쪽뿐이다 —
    //    그런데 `data/maps.ts`의 표준 배치 머리말이 반대를 적어 두었다("섞어야 요구가 여섯").
    //    **이 선이 우는 날(섞은 무리가 셋 다 선 안에 드는 날) 여덟째 맵이 열린다.**
    const safe = rostersOnly.filter(
      (t) =>
        medianOf(t, '보조 먼저') > WEAK_FLOOR &&
        ['아무거나', '화력 먼저'].every((name) => {
          const m = medianOf(t, name);
          return m > SHORTEST && m < LONGEST;
        }),
    );
    expect(
      safe.map((t) => t.label).sort(),
      `셋 다 선 안인 무리: ${safe.map((t) => `${t.label}(비 ${gap(t).toFixed(2)})`).join(' · ')}`,
    ).toEqual([ARCHERS, SHIELDS, NOW].sort());
    for (const t of safe) {
      if (t.label === NOW) continue;
      expect(
        gap(t),
        `${t.label}의 화력÷보조 ${gap(t).toFixed(2)} · 지금 ${gap(by(NOW)).toFixed(2)}`,
      ).toBeLessThan(gap(by(NOW)));
    }
    // 축이 실제로 넓다는 것도 한 줄로 못 박아 둔다 — 1.09(활잡이만)에서 6.02(돌진형만)이다.
    expect(gap(by(ARCHERS)), `활잡이만의 화력÷보조`).toBeLessThan(1.3);
    expect(gap(by(CHARGERS)), `돌진형만의 화력÷보조`).toBeGreaterThan(4);
  });
});
