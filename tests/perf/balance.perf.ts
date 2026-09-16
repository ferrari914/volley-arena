import { describe, expect, it } from 'vitest';
import { ENEMY, UPGRADE } from '../../src/data/config';
import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import {
  IDLE,
  backOffBomber,
  circleShield,
  median,
  neverStandStill,
  play,
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
 * **밸런스를 흔드는 바퀴가 보는 표.** 세 사람 × 씨앗 60개 = 180판.
 *
 * 왜 여기에 있나: 세션 17·19가 밸런스 값을 고를 때마다 "세 사람 × 씨앗 60개"를
 * 그 자리에서 새로 짜고, 재고, 지웠다. 매번 같은 코드를 다시 쓰는 것도 문제지만
 * **지운 뒤에는 다음 바퀴가 그 수치를 재현할 방법이 없다** — STATUS에 적힌 숫자가
 * 어떤 자로 잰 것인지 확인할 길이 없어진다. 그래서 자를 파일로 못 박는다.
 *
 * **`npm test`가 아니라 `npm run perf`에 두는 이유**는 하나뿐이다: 느리다(180판).
 * 매 바퀴 돌릴 필요도 없다 — `npm test`의 씨앗 20개가 매 바퀴 지키는 선이고,
 * 여기는 **값을 고르기 전후로 돌려 나란히 놓는 표**다.
 *
 * 씨앗은 `npm test`와 같은 자리에서 시작한다(20260909). 앞의 20개가 겹치므로
 * 두 표를 견줄 수 있다.
 */
const SEEDS = Array.from({ length: 60 }, (_, i) => 20260909 + i);

/** `tests/progression.test.ts`와 같은 선. 두 표가 같은 자를 써야 견줄 수 있다. */
const SHORTEST = 150;
const LONGEST = 330;

/**
 * 세 사람. **한 표 안에서는 셋 다 같은 발로 걷는다** — 표 하나가 가르는 것은 오직 고르기다.
 * 발을 가르는 것은 표와 표 사이다(아래 `walking` · `circling`). 한 표에서 두 축을 함께
 * 흔들면 수치가 달라졌을 때 무엇 때문인지 알 수 없다.
 *
 * 세션 17은 셋째 자리에 '무작위로 고르는 사람'을 뒀지만, 카드가 서는 자리를 섞은 뒤로는
 * 그 사람이 `takeAny`와 같은 사람이다. 그래서 **반대쪽 끝**을 세웠다 —
 * 보조만 고르는 사람은 화력이 가장 약하게 자라는 쪽이고, 아래쪽 꼬리는 늘 거기서 나온다.
 */
const PEOPLE: readonly { name: string; choose: Chooser; inWindow: boolean }[] = [
  { name: '아무거나 고르는 사람', choose: takeAny, inWindow: true },
  { name: '화력을 먼저 고르는 사람', choose: preferPower, inWindow: true },
  /**
   * **`inWindow`가 false인 단 한 사람.** 3~5분 선(④)을 이 사람으로 재지 않는다 —
   * 판이 짧은 것이 이 사람의 정의이기 때문이다(중앙 128초 · 선 아래). 세는 자리에 넣으면
   * 그 자리는 "밸런스가 선 안인가"가 아니라 **"반대쪽 끝이 얼마나 끝인가"**를 재게 된다.
   * 이 사람만 보는 선은 ②(중앙 > 120초)에 따로 있고, 그쪽이 훨씬 예민하다(아래 ④ 주석).
   */
  { name: '보조를 먼저 고르는 사람', choose: preferSupport, inWindow: false },
];

const inRange = (rows: readonly MatchResult[]): number =>
  rows.filter((r) => r.elapsed >= SHORTEST && r.elapsed <= LONGEST).length;

function line(name: string, rows: readonly MatchResult[]): string {
  const lengths = [...rows.map((r) => r.elapsed)].sort((a, b) => a - b);
  const pad = (n: number): string => n.toFixed(0).padStart(3, ' ');
  return (
    `  ${name.padEnd(12, ' ')} 중앙 ${pad(median(lengths))}초 · ` +
    `p5 ${pad(quantile(lengths, 0.05))} · p95 ${pad(quantile(lengths, 0.95))} · ` +
    `최단 ${pad(lengths[0] ?? 0)} · 최장 ${pad(lengths[lengths.length - 1] ?? 0)} · ` +
    `선 안 ${String(inRange(rows)).padStart(3, ' ')}/${rows.length}판 · ` +
    `Lv${median(rows.map((r) => r.level)).toFixed(0)} · ` +
    `${median(rows.map((r) => r.kills)).toFixed(0)}처치 · ` +
    `몸통 ${rows.reduce((s, r) => s + r.bodyHits, 0)}대 · ` +
    `막힘 ${rows.reduce((s, r) => s + r.blocked, 0)}발`
  );
}

/**
 * 서 있기. 합격선은 `npm test`가 지킨다 — 여기서는 표에 함께 적기만 한다.
 *
 * **씨앗 하나가 아니라 표와 같은 씨앗 전부를 돌린다**(세션 41). 이 줄이 씨앗 하나였을 때는
 * 같은 게임의 스무 판이 37~52초인데 48초 한 판만 표에 적혀, 표를 견주는 바퀴가
 * 그 한 판의 운을 게임의 변화로 읽었다.
 */
function standing(): { median: number; shortest: number; longest: number } {
  const seconds = SEEDS.map((seed) => {
    const world = new World({ seed });
    play(world, 60 * 120, () => IDLE);
    return world.elapsed;
  }).sort((a, b) => a - b);
  return {
    median: median(seconds),
    shortest: seconds[0] ?? 0,
    longest: seconds[seconds.length - 1] ?? 0,
  };
}

/** 세 사람을 한 벌 돌린다. 발이 바뀌면 사람 셋이 통째로 다른 판을 산다. */
const table = (
  input: (world: World) => FrameInput,
): { name: string; inWindow: boolean; rows: MatchResult[] }[] =>
  PEOPLE.map((p) => ({
    name: p.name,
    inWindow: p.inWindow,
    rows: SEEDS.map((seed) => playMatch(seed, 600, input, p.choose)),
  }));

/** 코어만 보고 걷는 사람들. 세션 15부터 이 표로 밸런스를 재 왔다. */
const walking = table(walkToNearestCore);
/**
 * 방패병을 돌고 터질 원에서는 물러나는 사람들(세션 24·51). 같은 씨앗·같은 고르기, 발만 다르다.
 *
 * **왜 도는 사람만 물러날 줄 아는가.** 위의 `walking`은 **아무 답도 모르는 사람**이고,
 * 3~5분 선은 그 사람으로 잰다(그 자리를 흔들면 세션 15부터의 표와 견줄 수 없다).
 * 여기 표가 묻는 것은 "방패병의 답이 통하는가" 하나인데, 돌기만 하는 사람은 **터질 원 안에서
 * 돌다가 반드시 맞는다**(돌기는 거리를 그대로 둔다 — `data/config.ts`의 `BOMBER`).
 * 그 사람으로 재면 방패병이 아니라 그 사람의 빈 구멍이 찍힌다.
 */
/**
 * **`neverStandStill`을 한 겹 더 씌웠다**(세션 75 · 투석병). 세션 74가
 * `tests/progression.test.ts`에 씌운 그 겹이고, 까닭은 `tail.perf.ts`의 같은 자리에
 * 표와 함께 적어 두었다 — **코어가 떨어져 발이 멎는 몇 초를 투석병이 고스란히 가져간다.**
 * 그 겹이 없으면 아래 ①(먹힌 비율)이 방패병이 아니라 멈춰 선 발을 잰다.
 */
const circling = table(neverStandStill(backOffBomber(circleShield)));

describe(`밸런스 표 — 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  it('180판이 밸런스 선 안에 든다', () => {
    const byPerson = walking;
    const all = byPerson.flatMap((p) => p.rows);
    /** ④가 재는 자리. 반대쪽 끝 한 사람은 빠져 있다(위 `PEOPLE`의 `inWindow`). */
    const inWindow = byPerson.filter((p) => p.inWindow).flatMap((p) => p.rows);

    console.log(
      [
        '',
        `  씨앗 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} · 사람 ${PEOPLE.length} · 모두 ${all.length}판`,
        `  한 판 합격선 ${SHORTEST}~${LONGEST}초 · 준비 시간 ${ENEMY.startDelay}초 · ` +
          `보조 상한 ${UPGRADE.maxSupport}장`,
        '',
        ...byPerson.map((p) => line(p.name, p.rows)),
        '',
        line('모두', all),
        `  선 안 잣대  ${inRange(inWindow)}/${inWindow.length}판 ` +
          `(${byPerson
            .filter((p) => p.inWindow)
            .map((p) => p.name)
            .join(' · ')} — ④가 재는 자리)`,
        (() => {
          const stood = standing();
          return (
            `  서 있기     중앙 ${stood.median.toFixed(0)}초 · ` +
            `최단 ${stood.shortest.toFixed(0)} · 최장 ${stood.longest.toFixed(0)} ` +
            `(합격선 중앙 60 · 최장 75 · npm test가 지킨다)`
          );
        })(),
        '',
      ].join('\n'),
    );

    // 아래 선들은 전부 실측에서 넉넉히 물러나 잡았다(세션 20). 이 표는 값을 고르는 자이지
    // 매 바퀴 지키는 문턱이 아니다 — 좁게 잡으면 밸런스를 만질 때마다 여기가 먼저 울어서
    // 정작 무엇이 달라졌는지를 못 읽는다. 매 바퀴의 문턱은 `tests/progression.test.ts`에 있다.
    const medians = byPerson.map((p) => median(p.rows.map((r) => r.elapsed)));
    const [any, power, support] = [medians[0] ?? 0, medians[1] ?? 0, medians[2] ?? 0];

    // ① 잘 고르는 두 사람은 3~5분 안에 끝난다(실측 중앙 243초 · 296초 —
    // 씨앗 창문 여덟 개에서 220~260 · 276~309초. 아래 ④의 표와 같은 자리에서 쟀다).
    expect(any, '아무거나 고르는 사람의 중앙값').toBeGreaterThan(SHORTEST);
    expect(any, '아무거나 고르는 사람의 중앙값').toBeLessThan(LONGEST);
    expect(power, '화력을 먼저 고르는 사람의 중앙값').toBeGreaterThan(SHORTEST);
    expect(power, '화력을 먼저 고르는 사람의 중앙값').toBeLessThan(LONGEST);

    // ② 보조만 골라도 판이 반토막 나지는 않는다. 여기가 무너지면
    // 3중 1택이 "화력 아니면 죽음"이 되어 고르기가 뜻을 잃는다.
    //
    // **반대쪽 끝 한 사람을 보는 선은 여기 하나뿐이다**(세션 56이 ④에서 그 사람을 뺐다).
    // 실측은 여덟 창문에서 123 · 126 · 127 · 127 · 128 · 130 · 131 · 133초
    // (평균 128.1 · 표준편차 3.0)로, 선(120)까지 남은 폭이 2.7σ다. ④가 그랬듯
    // **다음에 빨개질 자리는 여기다** — 이 사람을 더 깎는 값을 넣는 바퀴는 넣기 전후로
    // 이 표를 나란히 놓아라.
    expect(support, '보조를 먼저 고르는 사람의 중앙값').toBeGreaterThan(120);

    // ③ 그런데 고르기는 뜻이 있어야 한다(실측 296 / 130 = 2.26배 —
    // 여덟 창문에서 2.16~2.45배라 선 1.15배와는 한참 떨어져 있다).
    // 두 끝이 같은 값을 내면 카드는 장식이다.
    expect(power, `화력 ${power.toFixed(0)}초 vs 보조 ${support.toFixed(0)}초`).toBeGreaterThan(
      support * 1.15,
    );

    // ④ 표 전체의 모양.
    //
    // **'가장 긴 판'으로 재던 것을 p90으로 바꿨다(세션 40).** 게임을 한 줄도 안 바꾸고
    // 씨앗 블록만 옮겨 여섯 번 재니 그 값이 322~396초로 흔들렸다 — 420 선이 그 폭 바로 위라,
    // 밸런스와 무관한 씨앗 운이 통과 여부를 정하고 있었다(수치와 근거는
    // `tests/progression.test.ts`의 '위쪽 꼬리' 주석에 있다). 여기서도 같은 자를 쓴다.
    //
    // **'선 안'에서 반대쪽 끝 한 사람을 뺐다 — 180판이 아니라 120판을 센다(세션 56).**
    // 세션 20이 141/180을 보고 120을 잡았고, 그 뒤 폭탄병(51)과 카드 두 장(48·53)을 지나며
    // 실측이 115까지 내려와 **빨간 채로 두 바퀴를 지나왔다**(아무도 `npm run perf`를 안 돌린다 —
    // DESIGN '검사 명령'에 없다). 세션 56이 게임을 한 줄도 안 바꾸고 씨앗 창문만 옮겨
    // 여덟 번 재니, 선(120)이 **평균보다 위**에 있었다. 여덟 창문 중 둘에서만 통과한다:
    //
    // | 씨앗 창문 60개씩 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 평균 · 표준편차 |
    // |---|---|---|---|---|---|---|---|---|---|
    // | 아무거나 고르는 사람 | 53 | 45 | 50 | 55 | 54 | 53 | 56 | 55 | 52.6 |
    // | 화력을 먼저 고르는 사람 | 46 | 47 | 45 | 48 | 48 | 49 | 45 | 46 | 46.8 |
    // | **보조를 먼저 고르는 사람** | 16 | 15 | 20 | 14 | 22 | 19 | 16 | 11 | **16.6** |
    // | 셋 (옛 자 · 선 120) | 115 | 107 | 115 | 117 | **124** | **121** | 117 | 112 | 116.0 · 5.2 |
    // | **둘 (지금 자 · 선 85)** | 99 | 92 | 95 | 103 | 102 | 102 | 101 | 101 | **99.4 · 3.9** |
    //
    // **셋으로 세면 그 값은 밸런스를 재지 않는다.** 보조를 먼저 고르는 사람은 중앙이 128초로
    // 선(150) 아래라, 그 사람의 판은 **설계상 3분의 2가 선 밖**이다(60판 중 16판만 안에 든다).
    // 아무리 밸런스가 좋아져도 셋의 합은 64% 언저리에 묶이고, 더 나쁜 것은 **한쪽이 다른 쪽을
    // 가린다**는 것이다 — 게임이 전체적으로 느려지면 앞의 둘은 위로 새 나가는데 이 사람은
    // 오히려 선 안으로 들어와 합이 안 움직인다(세션 53의 밀어내기가 그렇게 보였다:
    // 51→53 · 49→46 · 22→16 = 122→115).
    // 이 사람을 안 세도 놓치는 것이 없다: 그 사람만 보는 선이 ②이고, 그쪽은 **여덟 창문 모두
    // 123~133초**(평균 128.1 · 표준편차 3.0)라 훨씬 예민하다. 아래쪽 꼬리는 `tail.perf.ts`가
    // 480판으로 따로 본다. **셋의 표는 위 console.log에 그대로 찍는다** — 안 세는 것이지
    // 안 보는 것이 아니다.
    //
    // **선을 85로 잡은 이유.** 여덟 창문의 실측이 92~103(평균 99.4 · 표준편차 3.9)이다.
    // 가장 나쁜 창문(92)에서 2σ 더 물러난 자리가 85다. 이 표는 값을 고르는 자이지 매 바퀴
    // 지키는 문턱이 아니므로(위 주석) 좁게 잡지 않는다 — 여기가 울면 **판의 12%p가 3~5분
    // 밖으로 나갔다**는 뜻이고, 그건 씨앗 운으로는 안 나는 크기다.
    // p90과 '가장 긴 판'은 그대로 180판 전부로 잰다. 위쪽 천장을 재는 값이라 짧은 판이
    // 섞이는 것이 선을 느슨하게 할 뿐 눈을 가리지 않는다.
    const lengths = [...all.map((r) => r.elapsed)].sort((a, b) => a - b);
    expect(
      inRange(inWindow),
      `선 안 ${inRange(inWindow)}/${inWindow.length}판 (반대쪽 끝은 ②가 본다)`,
    ).toBeGreaterThanOrEqual(85);
    expect(quantile(lengths, 0.9), '180판의 p90').toBeLessThan(LONGEST);
    expect(lengths[lengths.length - 1] ?? 0, '180판 중 가장 긴 판').toBeLessThan(480);

    // ⑤ 180판 어디에서도 판이 끝나지 않거나 준비 시간이 새지 않는다.
    // 씨앗 20개로는 못 보는 자리다 — `ENEMY.startDelay`가 새는 곳이 있으면 여기서 걸린다.
    for (const r of all) {
      expect(r.defeated, `씨앗 ${r.seed}의 판이 끝나지 않았다`).toBe(true);
      expect(r.firstHit, `씨앗 ${r.seed}의 첫 피격`).toBeGreaterThan(ENEMY.startDelay);
    }
  });

  /**
   * **같은 180판을 도는 발로 다시 재는 표**(세션 24 · `circleShield`).
   *
   * 세션 23이 방패병을 넣기 전후를 재고 "판 길이가 양쪽으로 벌어졌다"고 적었다
   * (선 안 141 → 124/180 · 최단 125 → 94초). 그 표를 잰 사람은 **돌 줄 모르는 사람**이다 —
   * `walkToNearestCore`는 코어만 보고 걸어서, 방패병이 요구하는 단 하나의 대응을 하지 않는다.
   * 세션 18이 아래쪽 꼬리에 대해 같은 질문을 하고 "재는 사람이 안 비켰을 뿐"이라는 답을 냈다.
   *
   * 그래서 여기서 재는 것은 게임이 아니라 **그 판정이 옳았는가**다.
   * 도는 것이 아래쪽 끝을 들어 올리면 벌어짐은 게임의 성질이 아니라 그 사람의 버릇이고,
   * 도는 사람에게도 그대로 남으면 그때는 방패병의 값을 고칠 자리가 있다는 뜻이다.
   */
  it('도는 사람의 180판 — 아래쪽 끝이 버릇인지 게임인지', () => {
    const all = circling.flatMap((p) => p.rows);
    const plain = walking.flatMap((p) => p.rows);
    const blocked = (rows: readonly MatchResult[]): number =>
      rows.reduce((s, r) => s + r.blocked, 0);
    /** 방패병에게 **닿은** 화살 중 판이 먹은 몫. 1에 가까울수록 정면으로만 쏜 것이다. */
    const eatenRate = (rows: readonly MatchResult[]): number => {
      const eaten = blocked(rows);
      const body = rows.reduce((s, r) => s + r.shieldBodyHits, 0);
      return eaten / Math.max(eaten + body, 1);
    };
    const shortest = (rows: readonly MatchResult[]): number =>
      Math.min(...rows.map((r) => r.elapsed));

    console.log(
      [
        '',
        `  같은 씨앗 ${SEEDS.length}개 · 같은 세 사람 · 발만 다르다(circleShield · 붙는 거리 3m)`,
        '',
        ...circling.map((p) => line(p.name, p.rows)),
        '',
        line('모두', all),
        `  안 도는 사람과 견주어: 선 안 ${inRange(plain)} → ${inRange(all)}/${all.length}판 · ` +
          `가장 짧은 판 ${shortest(plain).toFixed(0)} → ${shortest(all).toFixed(0)}초(씨앗을 타는 값이다) · ` +
          `막힘 ${blocked(plain)} → ${blocked(all)}발 · ` +
          `**먹힌 비율 ${eatenRate(plain).toFixed(3)} → ${eatenRate(all).toFixed(3)}**`,
        '',
      ].join('\n'),
    );

    // ① 도는 사람은 실제로 돌았다. 이 선이 깨지면 표가 아니라 자가 고장 난 것이다 —
    // 판이 먹는 몫이 줄지 않았다면 `circleShield`는 그냥 다르게 걷는 사람일 뿐이다.
    //
    // **막힌 발 수가 아니라 먹힌 비율로 잰다(세션 51).** 막힌 수는 *얼마나 쐈는가*와
    // *얼마나 막혔는가*를 한꺼번에 담은 값이다 — 방패병 곁에 오래 서 있기만 해도 커진다.
    // 적이 넷이 되어 자동 조준이 갈려 나가자 그 차이가 눈에 보이게 벌어졌다(세션 51의 실측):
    //   | 잰 것 | 세션 50의 게임 | 폭탄병을 넣고 |
    //   |---|---|---|
    //   | 막힌 발 수의 비 | 0.867 | **0.942** (선 0.9를 넘는다) |
    //   | 먹힌 비율 | 0.518 → 0.384 | 0.518 → **0.436** |
    // 왼쪽 자로 보면 "돌아도 소용없어졌다"이고 오른쪽 자로 보면 "여전히 통한다"인데,
    // **옳은 쪽은 오른쪽이다** — 방패병 하나와의 듀얼(`tests/progression.test.ts`)에서
    // 돌기의 값은 한 글자도 움직이지 않았다. 세션 48이 처치 수에서 화살 그 자체로
    // 자를 옮긴 것과 같은 일이다. **선(0.9)은 그대로 두고 자만 바꿨다.**
    expect(
      eatenRate(all),
      `먹힌 비율 ${eatenRate(plain).toFixed(3)} → ${eatenRate(all).toFixed(3)}`,
    ).toBeLessThan(eatenRate(plain) * 0.9);

    // ② 그리고 아래쪽 끝이 올라간다. 세션 23이 "방패병이 벌렸다"고 적은 그 끝이다.
    //
    // **'가장 짧은 판'이 아니라 p5로 잰다(세션 40).** 위쪽에서 겪은 것과 같은 일이 여기도 있었다 —
    // 세션 24가 쓴 대로 `shortest`로 재면, **게임을 한 줄도 안 바꾸고** 씨앗 블록만 옮겨
    // 여섯 번 재는 동안 **두 블록에서 이 선이 깨진다**(85 → 82초 · 88 → 76초).
    // 180판 중 단 한 판이 정하는 값이라, 도는 사람이 어쩌다 한 판을 못 살면 세션 24의 결론이
    // 뒤집힌 것처럼 보인다. **p5는 여섯 블록 모두에서, 고치기 전과 후 모두에서 올라간다**
    // (원본 106→145 · 111→144 · 114→132 · 105→135 · 104→132 · 114→134).
    // 세션 24의 주장은 그대로다. 바뀐 것은 그 주장을 재는 자뿐이다.
    const p5 = (rows: readonly MatchResult[]): number =>
      quantile(
        rows.map((r) => r.elapsed).sort((a, b) => a - b),
        0.05,
      );
    expect(p5(all), `p5 ${p5(plain).toFixed(0)} → ${p5(all).toFixed(0)}초`).toBeGreaterThan(
      p5(plain),
    );

    // ③ **그런데 위쪽은 반대로 갔다 — 이것이 세션 24가 새로 안 것이다.**
    // 도는 사람은 방패병을 빨리 지우고(처치 269 → 310) 그만큼 빨리 자라서, 잘 고르는 사람의
    // 판이 385 → **451초**까지 늘어난다(p95 360 → 398). 안 도는 사람의 표가 지키는 420선을
    // 도는 사람은 넘는다. **선을 여기서 옮겨 덮지 않는다** — 위쪽 천장은 증원(`REINFORCE`)이
    // 지는 몫이고, 그것을 고치는 것이 다음 일이다(STATUS '다음 할 일').
    // 여기 남기는 선은 그 일을 대신하지 않고 **영영 안 끝나는 판만** 잡는다.
    expect(Math.max(...all.map((r) => r.elapsed))).toBeLessThan(540);
    for (const r of all) expect(r.defeated, `씨앗 ${r.seed}의 판이 끝나지 않았다`).toBe(true);
  });
});
