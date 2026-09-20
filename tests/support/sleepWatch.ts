/**
 * **한 바퀴 동안 기계가 잠들었는지를 지켜본다.** 검사 하나가 아니라 검사 전체를 감싼다.
 *
 * 왜 있는가 — 세션 99(바퀴 #241)가 `npm test`가 빨개진 까닭을 끝까지 따라가 보니
 * **게임도 아니고 바쁜 기계도 아니고, 잠든 기계였다.**
 *   - 두 파일이 300초 한도를 넘겨 빨개졌고 한 바퀴가 **945초**를 썼다(평소 38초).
 *     그런데 그 두 파일은 **따로 돌리면 둘 다 통과한다**(36.6초 · 11.2초).
 *   - `pmset -g log`가 답을 갖고 있었다. 검사가 06:15:05에 시작했는데
 *     **06:15:15에 744초, 06:28:10에 160초 잠들었다 — 945초 중 904초다.**
 *     깨어 있던 41초는 평소 38초와 거의 같다. **검사는 느려진 적이 없다.**
 *   - 까닭은 하나다. 이 노트북이 **배터리로 돌고 있고(26% · 방전 중)** macOS가 몇 분마다 재운다.
 *     같은 이유로 바퀴 #238·#239는 아예 죽었다(`Your computer went to sleep mid-response`).
 *
 * 어떻게 아는가 — **박동을 센다.** 1초마다 깨어나 시계를 보는 타이머를 두고,
 * 두 박동 사이가 1초보다 한참 벌어졌으면 그 사이는 이 프로세스가 아예 멈춰 있던 시간이다.
 * 잠든 동안에는 타이머가 돌지 않으므로, 깬 뒤 첫 박동이 그 구멍을 통째로 들고 온다.
 *
 * **시계 둘을 견주는 방법은 쓰지 않는다 — 해 보고 아니어서 접었다.**
 * `performance.now()`가 darwin에서 잠든 동안 멈출 것이라 보고(`mach_absolute_time`)
 * `Date.now()`와의 차이로 재려 했는데, 세션 99가 실제로 재 보니 **둘이 갈리지 않았다**
 * (기계가 다섯 번 잠든 12분 동안 차이가 2초를 넘은 적이 없다). 요즘 libuv는
 * `mach_continuous_time`을 써서 **잠든 시간도 같이 센다.** 박동은 시계가 무엇이든 통한다.
 *
 * 왜 빨갛게 하지 않고 알리기만 하는가 — 빨간 신호는 이미 시간 초과가 내고 있다.
 * 없던 것은 **이름표**다. 다음 세션이 945초짜리 수수께끼를 다시 파지 않도록,
 * 표 바로 옆에 "기계가 잤다"를 적어 주는 것이 이 파일이 하는 일의 전부다.
 */

/** 박동 간격(ms). */
const TICK_MS = 1_000;

/**
 * 한 박동이 이만큼 늦으면 '멈춰 있었다'로 센다. 바쁜 기계도 타이머를 조금 늦추므로
 * 넉넉히 둔다 — 잠든 구멍은 수십~수백 초라 이 선과 헷갈릴 일이 없다.
 */
const LATE_MS = 3_000;

/** 이만큼 넘게 까먹었으면 알린다. 몇 초는 일상적인 오차라 굳이 말하지 않는다. */
const REPORT_GAP_MS = 5_000;

/**
 * 이 저장소는 `@types/node`를 넣지 않는다(DESIGN: 의존성이 적을수록 좋다).
 * `unref`는 node에만 있으므로 **쓰는 만큼만** 이름을 붙인다.
 * 이것이 없으면 타이머가 프로세스를 붙잡아 검사가 끝나도 안 죽는다.
 */
type NodeTimer = { unref(): void };

let lost = 0;
let lastTick = 0;
let wallStart = 0;
let timer: NodeTimer | undefined;

/** 박동 하나가 얼마나 늦었는지. 선 아래면 0(정상 오차로 본다). */
export const lateBy = (gapMs: number): number => {
  const late = gapMs - TICK_MS;
  return late > LATE_MS ? late : 0;
};

/** 사람이 읽을 줄. 잠든 시간과 실제로 일한 시간을 함께 적는다. */
export const describeSleep = (wallMs: number, lostMs: number): string => {
  const awake = Math.max(0, wallMs - lostMs);
  return (
    `이 바퀴 동안 기계가 ${(lostMs / 1000).toFixed(0)}초 멈춰 있었다. ` +
    `벽시계 ${(wallMs / 1000).toFixed(0)}초 중 실제로 일한 것은 ${(awake / 1000).toFixed(0)}초다.`
  );
};

export const setup = (): void => {
  lost = 0;
  wallStart = Date.now();
  lastTick = wallStart;
  const handle = setInterval(() => {
    const now = Date.now();
    lost += lateBy(now - lastTick);
    lastTick = now;
  }, TICK_MS) as unknown as NodeTimer;
  // 이 타이머 때문에 검사가 끝나고도 프로세스가 살아 있으면 안 된다.
  handle.unref();
  timer = handle;
};

export const teardown = (): void => {
  if (timer) clearInterval(timer as unknown as number);
  // 마지막 박동 뒤에 잠들었다면 그 구멍은 아직 안 세어졌다. 여기서 한 번 더 본다.
  lost += lateBy(Date.now() - lastTick);
  if (lost < REPORT_GAP_MS) return;

  console.warn(
    [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  [기계] ${describeSleep(Date.now() - wallStart, lost)}`,
      '',
      '  검사의 시간 한도는 벽시계로 재므로, 멈춰 있던 시간은 그대로 시간 초과가 된다.',
      '  **시간 초과가 났다면 게임이 깨진 것이 아니다.** 빨개진 검사를 따로 돌려 보라 —',
      '  대개 통과한다. 코드를 파기 전에 이 줄을 먼저 믿어라.',
      '',
      '  뿌리는 전원이다. 노트북이 배터리로 돌면 macOS가 몇 분마다 재운다.',
      '  전원을 꽂거나 `caffeinate -i`로 붙잡아 두지 않으면 다음 바퀴도 같은 일을 겪는다.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    ].join('\n'),
  );
};
