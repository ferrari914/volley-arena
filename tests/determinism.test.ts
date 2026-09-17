import { describe, expect, it } from 'vitest';
import {
  playMatch,
  preferPower,
  preferSupport,
  takeAny,
  walkToNearestCore,
  type Chooser,
} from './support/match';

/**
 * **같은 씨앗이 정말 같은 판인가** (세션 91).
 *
 * 왜 이 자가 있나: 이 저장소가 쌓아 온 표 스무 남짓은 **전부 다른 판·다른 날에 잰 수를
 * 나란히 놓고 견준 것**이다(세션 85의 반지름 · 86의 배치 · 88의 증원 · 89의 무리…).
 * 그 견주기는 **같은 씨앗이 언제 돌려도 같은 판**이라야 성립한다. `World`가 `Math.random`을
 * 쓰지 않고 LCG를 쓰는 까닭이 그것이고(`World.ts`의 `makeRandom`), `vitest.perf.config.ts`도
 * *"씨앗이 고정된 결정적 계산이라 결과가 늘 같은데"*를 전제로 적혀 있다.
 *
 * **그런데 세션 91이 그 전제가 깨진 판을 한 번 봤다.** `tests/perf/roster.perf.ts`를
 * **한 글자도 안 바꾸고 다섯 번** 돌렸는데, 스물넷 칸 중 **두 칸**이 첫 판에서만 달랐다:
 * | | 첫 판 | 나머지 네 판 |
 * |---|---|---|
 * | 돌진형만 · 보조 먼저 | 중앙 **47**초 · p90 **241** · 선 안 **16**판(60판 중) | 중앙 **41**초 · p90 **57** · 선 안 **1**판(60판 중) |
 * | 한 칸 · 아무거나 | 중앙 **245**초 · p90 **324** | 중앙 **247**초 · p90 **332** |
 *
 * **까닭은 못 찾았다. 찾아본 것과 그 답은 이렇다**(추측으로 채우지 않는다):
 * - **재는 코드의 entropy**: `src/`에 `Math.random`·`Date.now`·`performance.now`가 **없다**
 *   (렌더러·`Ticker`·`AdBreak`에만 있고 시뮬레이션은 안 쓴다). 모듈 수준의 변수도 없다.
 * - **한 프로세스 안에서 두 번**: 같은 60판을 앞뒤로 두 번 돌려 **합이 소수점까지 같았다**.
 *   사이에 다른 판 120개를 끼워 넣어도(JIT가 데워진 뒤) 같았다.
 * - **다른 프로세스 셋**: 같은 줄을 새 프로세스로 세 번 돌려 **전부 같았다**.
 * - **바쁜 기계**: CPU를 네 갈래로 나눠 쓰게 해서 벽시계를 **47 → 165초**로 늘려 돌렸는데도
 *   표가 **한 글자도 안 달랐다.** 곧 '기계가 바빠서'는 아니다.
 * - 갈린 자리의 모양만은 분명하다 — **짧게 끝난 판은 첫 판에서도 똑같았고**(p5 26초가 같다)
 *   **길게 간 판만 갈렸다.** 아주 작은 수 차이가 판이 길수록 커지는 모양이다.
 *
 * **그래서 이 자를 세운다.** 까닭을 모르는 채로 할 수 있는 일은 **다시 일어나면 알아채는
 * 것**이다. 아래 아홉 판은 값을 손으로 박아 두었다(`npm test`가 매번 다시 잰다).
 * **이 자가 빨개지면 고칠 것은 이 파일이 아니다** — 그 순간 이 저장소의 표 전부가
 * "같은 판을 잰 것"이 아니게 되므로, **빨개진 그 값을 STATUS에 적고 원인부터 찾아라.**
 * 값을 새로 찍어 덮어쓰면 그 사건이 사라진다.
 */
interface Golden {
  seed: number;
  choose: Chooser;
  name: string;
  elapsed: number;
  kills: number;
  level: number;
  hits: number;
}

/** 세 사람 × 씨앗 셋. 길게 가는 판을 일부러 넣었다 — 갈린 것이 긴 판이었다. */
const GOLDEN: readonly Golden[] = [
  { seed: 20260909, choose: takeAny, name: '아무거나', elapsed: 262.816667, kills: 293, level: 18, hits: 969 },
  { seed: 20260924, choose: takeAny, name: '아무거나', elapsed: 113.583333, kills: 89, level: 12, hits: 303 },
  { seed: 20260939, choose: takeAny, name: '아무거나', elapsed: 215.2, kills: 191, level: 16, hits: 615 },
  { seed: 20260909, choose: preferPower, name: '화력 먼저', elapsed: 269.15, kills: 334, level: 17, hits: 1159 },
  { seed: 20260924, choose: preferPower, name: '화력 먼저', elapsed: 169.866667, kills: 155, level: 15, hits: 538 },
  { seed: 20260939, choose: preferPower, name: '화력 먼저', elapsed: 294.666667, kills: 395, level: 18, hits: 1406 },
  { seed: 20260909, choose: preferSupport, name: '보조 먼저', elapsed: 130.05, kills: 79, level: 13, hits: 267 },
  { seed: 20260924, choose: preferSupport, name: '보조 먼저', elapsed: 59.066667, kills: 24, level: 8, hits: 113 },
  { seed: 20260939, choose: preferSupport, name: '보조 먼저', elapsed: 202.116667, kills: 166, level: 16, hits: 568 },
];

describe('같은 씨앗은 같은 판이다 — 표를 견줄 수 있게 하는 전제', () => {
  /**
   * 손으로 박아 둔 아홉 판. 한 판이 얼마나 걸리는지가 아니라 **판 자체가 같은지**를 본다.
   * `elapsed`는 스텝 수 × `DT`라 **한 스텝만 갈려도 어긋난다** — 가장 예민한 칸이다.
   */
  it('손으로 박아 둔 아홉 판이 스텝 하나까지 그대로다', () => {
    for (const g of GOLDEN) {
      const r = playMatch(g.seed, 600, walkToNearestCore, g.choose);
      const who = `씨앗 ${g.seed} · ${g.name}`;
      expect(r.elapsed, `${who}의 한 판 길이`).toBeCloseTo(g.elapsed, 5);
      expect(r.kills, `${who}의 처치`).toBe(g.kills);
      expect(r.level, `${who}의 레벨`).toBe(g.level);
      expect(r.hits, `${who}의 명중`).toBe(g.hits);
    }
  });

  /**
   * 한 프로세스 안에서 두 번 돌린 판이 같은지. 위 자가 프로세스 사이를 본다면 이 자는
   * **앞 판이 뒤 판에 흘리는 것**을 본다(모듈 수준에 남는 값 · 풀에 남는 찌꺼기).
   * 세션 91이 실제로 이 둘을 갈라 확인했고, 흘리는 것은 없었다.
   */
  it('앞 판이 뒤 판에 아무것도 흘리지 않는다', () => {
    const first = playMatch(20260909, 600, walkToNearestCore, preferPower);
    playMatch(20260931, 600, walkToNearestCore, takeAny);
    const again = playMatch(20260909, 600, walkToNearestCore, preferPower);
    expect(again.elapsed, '사이에 딴 판을 끼운 뒤의 같은 씨앗').toBeCloseTo(first.elapsed, 5);
    expect(again.kills, '사이에 딴 판을 끼운 뒤의 처치').toBe(first.kills);
    expect(again.hits, '사이에 딴 판을 끼운 뒤의 명중').toBe(first.hits);
  });
});
