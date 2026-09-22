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
 * **멈춘 몫이 이 선을 넘으면 "따로 돌려 보라"만 적고 끝내지 않는다.**
 *
 * 세션 99가 이 자를 만들 때 겪은 바퀴는 945초 중 904초를 잤고(95.7%), 그때는 빨개진 파일을
 * 따로 돌리니 통과했다. 그래서 그 말이 적혔다. **세션 112(바퀴 #363)에서 같은 말이 틀렸다** —
 * 3191초 중 3142초를 자고(98.5%) `tests/maps.test.ts`가 넷 빨개졌는데, 그 파일을
 * `caffeinate -i -m -s`로 감싸 **따로 돌려도 셋이 또 빨개졌다**(2089초 중 2041초 잠 · 97.7%).
 *
 * 두 바퀴를 가른 것은 몫이 아니라 **다시 돌리는 동안 기계가 또 자느냐**다. 세션 99의 기계는
 * 그 사이 깨어 있었고, 세션 112의 기계는 덮개가 닫힌 채 배터리로 돌아 계속 잤다.
 * 그러니 이 자가 할 수 있는 정직한 말은 "통과한다"가 아니라 **"다시 돌리기 전에 기계를 보라"**다 —
 * 그 확인은 1초면 끝나고, 건너뛰면 세션 112처럼 35분을 버린다.
 */
export const HEAVY_SHARE = 0.9;

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

/** 벽시계 가운데 멈춰 있던 몫(0~1). 벽시계가 0이면 0으로 본다(0으로 나누지 않는다). */
export const stallShare = (wallMs: number, lostMs: number): number =>
  wallMs <= 0 ? 0 : Math.min(1, lostMs / wallMs);

/**
 * **이 바퀴에 뭐라고 적어 줄지를 정한다.** 멈춘 몫 하나로 갈린다(`HOPELESS_SHARE`).
 * 판단만 여기 두는 까닭은 `teardown`을 검사로 부를 수 없기 때문이다 —
 * 기계를 재우는 일은 손으로 못 하지만, **무슨 말을 적을지는 손으로 박은 값으로 잴 수 있다.**
 */
export const adviceFor = (wallMs: number, lostMs: number): string[] => {
  const share = stallShare(wallMs, lostMs);
  if (share < HEAVY_SHARE) {
    return [
      '  검사의 시간 한도는 벽시계로 재므로, 멈춰 있던 시간은 그대로 시간 초과가 된다.',
      '  **시간 초과가 났다면 게임이 깨진 것이 아니다.** 빨개진 검사를 따로 돌려 보라 —',
      '  대개 통과한다. 코드를 파기 전에 이 줄을 먼저 믿어라.',
    ];
  }
  return [
    '  **시간 초과가 났다면 게임이 깨진 것이 아니다.** 코드를 파지 마라.',
    `  다만 멈춘 몫이 ${(share * 100).toFixed(1)}%다. 이만큼 자는 기계에서는 **빨개진 검사를 따로`,
    '  돌려도 또 빨개진다** — 깨어 있는 창이 시간 한도(300초)보다 짧게 쪼개지기 때문이다.',
    '  세션 112가 그렇게 35분을 버렸다. **다시 돌리기 전에 아래 두 줄로 기계부터 보라.**',
    '  덮개가 닫혀 있거나 배터리로 돌고 있으면, 그것을 고치기 전에는 다시 돌리지 마라.',
  ];
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

  const wall = Date.now() - wallStart;
  console.warn(
    [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  [기계] ${describeSleep(wall, lost)}`,
      '',
      ...adviceFor(wall, lost),
      '',
      '  뿌리는 둘이고, 둘 다 사용자 손이다: **배터리로 도는 것**과 **덮개가 닫혀 있는 것**.',
      '  `caffeinate -i`는 이미 loop.sh에 켜져 있고(KEEP_AWAKE=1) 유휴 잠만 막는다 —',
      '  덮개 잠(Clamshell Sleep)은 못 막는다. 세션 112가 `-i -m -s`까지 줘 봤지만 같았다.',
      '  확인하는 법: `ioreg -r -k AppleClamshellState`(Yes면 닫혀 있다) · `pmset -g batt`.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    ].join('\n'),
  );
};
