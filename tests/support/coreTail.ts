/**
 * **`[코어]` 판정을 출력의 맨 끝, `Duration` 줄 아래에 한 번 더 적는다.**
 *
 * 왜 있는가 — 까닭과 내력은 `tests/support/coreSpeed.ts`의 `coreTailFor` 머리말에 있다.
 * 한 줄로 줄이면: **이 저장소의 세 이름표 중 `[코어]`만 출력의 앞머리에 떨어지는데,
 * 그 이름표가 뜻을 붙여 주는 수(`Duration`)는 맨 끝에 있다.** `[기계]`(`sleepWatch`의
 * `teardown`)와 `[빠짐]`(`ranAll`의 `onTestRunEnd`)은 둘 다 이미 끝에서 찍힌다.
 * 그래서 `tail`로 읽는 세션에게는 셋 중 둘만 보이고, 없는 하나가 하필 초를 다루는 자다.
 *
 * 재는 일은 일꾼 안에서만 할 수 있고(그 일꾼이 얻은 코어를 재는 것이 요점이다) 끝에
 * 적는 일은 본 프로세스에서만 할 수 있으므로, 둘 사이를 vitest가 마련해 둔 통로로 잇는다 —
 * 검사가 `task.meta`에 적으면 리포터가 `testCase.meta()`로 받는다.
 *
 * **왜 빨갛게 하지 않는가** — `ranAll`·`sleepWatch`와 같다. 느린 코어는 고장이 아니고
 * 사람이 이 기계를 쓰는 중이라는 뜻일 뿐이다. 없던 것은 읽히는 자리의 이름표다.
 */
import { coreTailFor } from './coreSpeed';

/** 검사가 `task.meta`의 이 칸에 적는다. 리포터가 이 이름으로 찾는다. */
export const META_KEY = 'coreSpeed';

/**
 * 검사가 남긴 칸에서 속도를 꺼낸다. **모양이 조금이라도 다르면 없는 것으로 친다** —
 * 여기서 억지로 읽어 내면 없는 경고를 지어내게 되고, 그것이 세션 116이 고친 병이다.
 */
export const nsFromMeta = (meta: unknown): number | null => {
  if (typeof meta !== 'object' || meta === null) return null;
  const slot = (meta as Record<string, unknown>)[META_KEY];
  if (typeof slot !== 'object' || slot === null) return null;
  const ns = (slot as Record<string, unknown>).ns;
  return typeof ns === 'number' && Number.isFinite(ns) && ns > 0 ? ns : null;
};

/**
 * **꼬리에 찍을 줄.** 잰 값이 없거나 `fast`면 빈 배열이다(아무 말도 하지 않는다).
 * 판단은 전부 `coreTailFor`가 하고 여기서는 테두리만 두른다 —
 * 두 곳이 따로 판단하면 언젠가 갈린다.
 */
export const describeCoreTail = (ns: number | null): string[] => {
  if (ns === null) return [];
  const said = coreTailFor(ns);
  if (said.length === 0) return [];
  return [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ...said,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];
};

/** vitest가 넘겨주는 것 중 이 자가 쓰는 것만 이름 붙인다(`ranAll.ts`와 같은 규칙). */
type Cased = { meta(): unknown };

/**
 * `vitest.config.ts`가 이름으로 불러 `new` 하는 자.
 * **어떤 일이 있어도 검사를 죽이지 않는다** — 곁다리 하나 때문에 바퀴가 통째로 날아가면
 * 손해가 더 크다(`ranAll.ts`와 같은 규칙).
 */
export default class CoreTailReporter {
  private ns: number | null = null;

  onTestCaseResult(testCase: Cased): void {
    try {
      const found = nsFromMeta(testCase.meta());
      if (found !== null) this.ns = found;
    } catch {
      /* 곁다리가 검사를 죽이지 않는다 */
    }
  }

  onTestRunEnd(): void {
    try {
      const lines = describeCoreTail(this.ns);
      if (lines.length > 0) console.warn(lines.join('\n'));
    } catch {
      /* 곁다리가 검사를 죽이지 않는다 */
    }
  }
}
