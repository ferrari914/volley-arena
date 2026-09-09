import { describe, expect, it } from 'vitest';
import { ENEMY, UPGRADE } from '../../src/data/config';
import { World } from '../../src/core/World';
import {
  IDLE,
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
 * 세 사람. **셋 다 같은 발로 걷는다**(`walkToNearestCore`) — 여기서 가르는 것은 오직 고르기다.
 * 어떻게 움직이는가를 가르는 자는 `tests/progression.test.ts`에 따로 있다(`dodgeCharger`).
 * 한 표에서 두 축을 함께 흔들면 수치가 달라졌을 때 무엇 때문인지 알 수 없다.
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
    `몸통 ${rows.reduce((s, r) => s + r.bodyHits, 0)}대`
  );
}

/** 서 있기. 합격선은 `npm test`가 지킨다 — 여기서는 표에 함께 적기만 한다. */
function standing(): number {
  const world = new World();
  play(world, 60 * 120, () => IDLE);
  return world.elapsed;
}

describe(`밸런스 표 — 세 사람 × 씨앗 ${SEEDS.length}개`, () => {
  it('180판이 밸런스 선 안에 든다', () => {
    const byPerson = PEOPLE.map((p) => ({
      ...p,
      rows: SEEDS.map((seed) => playMatch(seed, 600, walkToNearestCore, p.choose)),
    }));
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

    // ④ 표 전체의 모양. 실측 선 안 141/180판 · 최장 371초.
    expect(inRange(all)).toBeGreaterThanOrEqual(120);
    expect(Math.max(...all.map((r) => r.elapsed))).toBeLessThan(420);

    // ⑤ 180판 어디에서도 판이 끝나지 않거나 준비 시간이 새지 않는다.
    // 씨앗 20개로는 못 보는 자리다 — `ENEMY.startDelay`가 새는 곳이 있으면 여기서 걸린다.
    for (const r of all) {
      expect(r.defeated, `씨앗 ${r.seed}의 판이 끝나지 않았다`).toBe(true);
      expect(r.firstHit, `씨앗 ${r.seed}의 첫 피격`).toBeGreaterThan(ENEMY.startDelay);
    }
  });
});
