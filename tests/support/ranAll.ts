/**
 * **열기로 한 검사 파일 중 아예 시작조차 못 한 것이 있으면 그 사실을 표 옆에 적는다.**
 *
 * 왜 있는가 — 세션 114(바퀴 #436)가 `npm test`를 돌린 결과 표가 이랬다:
 *
 * ```
 *  Test Files  9 passed (9)
 *       Tests  171 passed (171)
 *      Errors  9 errors
 * ```
 *
 * **이 저장소의 검사 파일은 18개이고 검사는 453개였다**(이 자를 만들며 5개가 늘어 458개다).
 * 곧 절반이 안 돌았는데 표는
 * "9 passed (9)"라고 적는다 — vitest는 **결과를 낸 파일만 세기** 때문이다. 안 돈 9개는
 * 실패로 세어지지 않고 `Unhandled Errors` 쪽에 `Failed to start forks worker ...
 * Timeout waiting for worker to respond`로 따로 쌓인다(그래서 종료 코드는 1이다).
 *
 * 무엇이 위험한가 — **이 저장소는 세션마다 "436/436 · 30초"처럼 수를 적어 넘긴다.**
 * 꼬리만 보고 "171/171 통과"를 적으면 그 기록은 거짓이 된다. 안 돈 파일은 통과한 것이
 * 아닌데, 표의 낱말은 둘 다 `passed`라 눈으로는 갈리지 않는다. 세션 110이 이미 같은 병을
 * 한 번 앓았다(글자를 세다가 틀렸고, 세는 일을 기계에 넘겨 `npm run deaths`가 나왔다).
 * **그래서 이번에도 세는 일을 기계에 넘긴다 — 몇 개를 열기로 했고 몇 개가 돌았는지는
 * vitest 자신이 알고 있다.**
 *
 * 까닭은 대개 잠이다. 일꾼(worker)이 깨어 있는 창보다 오래 대답을 못 하면 vitest가 그
 * 파일을 포기한다. 그 판정은 `tests/support/sleepWatch.ts`의 `[기계]` 줄이 이미 하고
 * 있으므로, 이 파일은 **무엇이 빠졌는지만** 적는다(까닭은 그 줄을 가리킨다).
 *
 * **왜 빨갛게 하지 않고 알리기만 하는가** — `sleepWatch`와 같은 이유다. 빨간 신호는
 * 이미 `Unhandled Errors`가 내고 있고(종료 코드 1), 없던 것은 **이름표**다.
 * 여기서 종료 코드를 건드리면, 기계 사정으로 빨개진 바퀴와 게임이 깨진 바퀴를
 * 다음 세션이 다시 구분할 수 없게 된다.
 */

/** 결과를 냈다고 볼 수 있는 상태. `queued`·`pending`은 **열지도 못했거나 도중에 끊긴 것**이다. */
export const didRun = (state: string): boolean =>
  state === 'passed' || state === 'failed' || state === 'skipped';

/**
 * 절대 경로에서 읽을 만큼만 남긴다. 표에 절대 경로를 늘어놓으면 읽히지 않는다.
 * `tests/`가 있으면 거기서 자르고, 없으면 **마지막 두 칸**을 남긴다
 * (자를 증명하며 만든 `tmp-proof/bb.test.mjs`가 통째로 찍혀서 붙인 갈래다).
 */
export const shortName = (moduleId: string): string => {
  const cut = moduleId.lastIndexOf('/tests/');
  if (cut >= 0) return moduleId.slice(cut + 1);
  const parts = moduleId.split('/').filter((p) => p !== '');
  return parts.length <= 2 ? moduleId : parts.slice(-2).join('/');
};

/** 열기로 했는데 결과를 내지 못한 파일. 열기로 한 순서를 그대로 지킨다. */
export const missingModules = (
  planned: readonly string[],
  ran: readonly string[],
): string[] => {
  const done = new Set(ran);
  return planned.filter((id) => !done.has(id));
};

/**
 * **표 옆에 적을 줄.** 빠진 것이 없으면 빈 배열이다(아무 말도 하지 않는다).
 * 판단만 여기 두는 까닭은 `sleepWatch.adviceFor`와 같다 — 일꾼을 굶겨 파일을 못 열게 하는
 * 상황은 손으로 만들 수 없지만, **무슨 말을 적을지는 손으로 박은 값으로 잴 수 있다.**
 */
export const describeMissing = (
  planned: readonly string[],
  ran: readonly string[],
): string[] => {
  const missing = missingModules(planned, ran);
  if (missing.length === 0) return [];
  return [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `  [빠짐] 열기로 한 검사 파일 ${planned.length}개 중 ${missing.length}개가 아예 시작되지 못했다.`,
    '',
    '  **위 표의 수를 그대로 STATUS에 적지 마라.** vitest는 결과를 낸 파일만 센다 —',
    '  안 돈 파일은 통과로도 실패로도 안 세어지고 `Unhandled Errors` 쪽에만 쌓인다.',
    `  이 바퀴가 실제로 돈 것은 ${planned.length}개 중 ${ran.length}개다.`,
    '',
    ...missing.map((id) => `    · ${shortName(id)}`),
    '',
    '  까닭은 대개 위의 `[기계]` 줄에 있다. 자는 기계에서는 일꾼이 제때 대답하지 못해',
    '  vitest가 파일을 열지도 못한다(`Timeout waiting for worker to respond`).',
    '  그 줄이 함께 있으면 게임 탓이 아니다 — 덮개와 전원부터 보라.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];
};

/** vitest가 넘겨주는 것 중 이 자가 쓰는 것만 이름 붙인다(`@types/node`를 안 넣는 것과 같은 규칙). */
type Planned = { readonly moduleId: string };
type Ran = { readonly moduleId: string; state(): string };

/**
 * `vitest.config.ts`가 이름으로 불러 `new` 하는 자. **어떤 일이 있어도 검사를 죽이지 않는다** —
 * 이 자는 곁다리이고, 여기서 던진 예외 때문에 바퀴 하나가 통째로 날아가면 손해가 더 크다.
 */
export default class RanAllReporter {
  private planned: string[] = [];

  onTestRunStart(specifications: ReadonlyArray<Planned>): void {
    try {
      this.planned = specifications.map((s) => s.moduleId);
    } catch {
      this.planned = [];
    }
  }

  onTestRunEnd(testModules: ReadonlyArray<Ran>): void {
    try {
      const ran = testModules.filter((m) => didRun(m.state())).map((m) => m.moduleId);
      const lines = describeMissing(this.planned, ran);
      if (lines.length > 0) console.warn(lines.join('\n'));
    } catch {
      /* 곁다리가 검사를 죽이지 않는다 */
    }
  }
}
