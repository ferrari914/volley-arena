import { describe, expect, it } from 'vitest';
import { ENEMY, UPGRADE } from '../../src/data/config';
import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import {
  IDLE,
  circleShield,
  median,
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
const PEOPLE: readonly { name: string; choose: Chooser }[] = [
  { name: '아무거나 고르는 사람', choose: takeAny },
  { name: '화력을 먼저 고르는 사람', choose: preferPower },
  { name: '보조를 먼저 고르는 사람', choose: preferSupport },
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

/** 서 있기. 합격선은 `npm test`가 지킨다 — 여기서는 표에 함께 적기만 한다. */
function standing(): number {
  const world = new World();
  play(world, 60 * 120, () => IDLE);
  return world.elapsed;
}

/** 세 사람을 한 벌 돌린다. 발이 바뀌면 사람 셋이 통째로 다른 판을 산다. */
const table = (input: (world: World) => FrameInput): { name: string; rows: MatchResult[] }[] =>
  PEOPLE.map((p) => ({
    name: p.name,
    rows: SEEDS.map((seed) => playMatch(seed, 600, input, p.choose)),
  }));

/** 코어만 보고 걷는 사람들. 세션 15부터 이 표로 밸런스를 재 왔다. */
const walking = table(walkToNearestCore);
/** 방패병을 도는 사람들(세션 24). 같은 씨앗·같은 고르기, 발만 다르다. */
const circling = table(circleShield);

describe(`밸런스 표 — 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  it('180판이 밸런스 선 안에 든다', () => {
    const byPerson = walking;
    const all = byPerson.flatMap((p) => p.rows);

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
        `  서 있기 ${standing().toFixed(0)}초 (합격선 60 · npm test가 지킨다)`,
        '',
      ].join('\n'),
    );

    // 아래 선들은 전부 실측에서 넉넉히 물러나 잡았다(세션 20). 이 표는 값을 고르는 자이지
    // 매 바퀴 지키는 문턱이 아니다 — 좁게 잡으면 밸런스를 만질 때마다 여기가 먼저 울어서
    // 정작 무엇이 달라졌는지를 못 읽는다. 매 바퀴의 문턱은 `tests/progression.test.ts`에 있다.
    const medians = byPerson.map((p) => median(p.rows.map((r) => r.elapsed)));
    const [any, power, support] = [medians[0] ?? 0, medians[1] ?? 0, medians[2] ?? 0];

    // ① 잘 고르는 두 사람은 3~5분 안에 끝난다(실측 249초 · 249초).
    expect(any, '아무거나 고르는 사람의 중앙값').toBeGreaterThan(SHORTEST);
    expect(any, '아무거나 고르는 사람의 중앙값').toBeLessThan(LONGEST);
    expect(power, '화력을 먼저 고르는 사람의 중앙값').toBeGreaterThan(SHORTEST);
    expect(power, '화력을 먼저 고르는 사람의 중앙값').toBeLessThan(LONGEST);

    // ② 보조만 골라도 판이 반토막 나지는 않는다(실측 153초). 여기가 무너지면
    // 3중 1택이 "화력 아니면 죽음"이 되어 고르기가 뜻을 잃는다.
    expect(support, '보조를 먼저 고르는 사람의 중앙값').toBeGreaterThan(120);

    // ③ 그런데 고르기는 뜻이 있어야 한다(실측 249 / 153 = 1.63배).
    // 두 끝이 같은 값을 내면 카드는 장식이다.
    expect(power, `화력 ${power.toFixed(0)}초 vs 보조 ${support.toFixed(0)}초`).toBeGreaterThan(
      support * 1.15,
    );

    // ④ 표 전체의 모양. 실측 선 안 141/180판 · p90 312초.
    //
    // **'가장 긴 판'으로 재던 것을 p90으로 바꿨다(세션 40).** 게임을 한 줄도 안 바꾸고
    // 씨앗 블록만 옮겨 여섯 번 재니 그 값이 322~396초로 흔들렸다 — 420 선이 그 폭 바로 위라,
    // 밸런스와 무관한 씨앗 운이 통과 여부를 정하고 있었다(수치와 근거는
    // `tests/progression.test.ts`의 '위쪽 꼬리' 주석에 있다). 여기서도 같은 자를 쓴다.
    const lengths = [...all.map((r) => r.elapsed)].sort((a, b) => a - b);
    expect(inRange(all)).toBeGreaterThanOrEqual(120);
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
          `막힘 ${blocked(plain)} → ${blocked(all)}발`,
        '',
      ].join('\n'),
    );

    // ① 도는 사람은 실제로 돌았다. 이 선이 깨지면 표가 아니라 자가 고장 난 것이다 —
    // 판에 막힌 화살이 줄지 않았다면 `circleShield`는 그냥 다르게 걷는 사람일 뿐이다.
    // 실측 2만 발 언저리에서 한 자릿수 퍼센트가 아니라 눈에 보이게 줄어야 한다.
    expect(blocked(all), `막힘 ${blocked(plain)} → ${blocked(all)}발`).toBeLessThan(
      blocked(plain) * 0.9,
    );

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
