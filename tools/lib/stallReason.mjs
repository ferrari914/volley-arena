/**
 * **시계가 섰을 때 왜 섰는지를 한 줄로 옮기는 자리.**
 *
 * 화면에서 값을 긁어 오는 일(`page.evaluate`)과, 그 값을 읽고 뭐라고 적을지 정하는 일은
 * 다른 일이다. 여기 있는 것은 뒤엣것뿐이라 브라우저 없이도 검사가 돈다 —
 * 그리고 **검사가 필요한 쪽이 바로 이쪽이었다.**
 *
 * 세션 32~34가 남긴 실패 문구는 이렇게 적혀 있었다:
 * `브라우저가 3.0초에 106장만 그린다 (35.13fps · ... 0.6fps 아래면 시계는 20초에 1초도 못 간다)`.
 * **한 문장이 제 숫자와 어긋난다** — 35fps는 0.6fps 아래가 아니다. 그런데 문구를 읽는 사람에게는
 * "브라우저가 못 그린다"만 남아서, 세 바퀴가 이 기계의 느림을 쫓았다.
 * 사람이 매번 잡아낼 수 없는 종류의 어긋남이라 검사로 내린다(`tests/stallReason.test.mjs`).
 */

/** 게임 시계가 한 프레임에 흐를 수 있는 최대 시간(s). `Ticker`의 `fixedDt * maxSteps`다. */
export const MAX_GAME_SECONDS_PER_FRAME = (1 / 60) * 5;

/** 시계가 이만큼(s) 한 칸도 안 넘어가면 재는 자가 "섰다"고 적는다(`tools/shot.mjs`). */
export const FROZEN_LIMIT = 20;

/**
 * **시계가 진짜로 설 수 있는 마지막 속도(fps). 0.6이다.**
 * 시계는 초 단위로만 적히므로, `FROZEN_LIMIT`초 안에 게임 시간이 1초도 안 흐르려면
 * 틱이 `1 / (20 × 83ms)` = 0.6fps 아래로 기어가야 한다.
 * **이 위라면 시계는 느리더라도 반드시 움직였어야 한다** — 그때는 기계가 느린 것이 아니라
 * 설명이 없는 것이고, 그렇게 적어야 다음 바퀴가 엉뚱한 데를 파지 않는다.
 */
export const STALL_FPS = 1 / (FROZEN_LIMIT * MAX_GAME_SECONDS_PER_FRAME);

/**
 * 화면이 덮여 있거나 틱이 꺼져 있는 자리를 먼저 짚는다. 짚을 것이 없으면 null —
 * 그때만 프레임을 세러 간다(3초가 드는 일이라 필요할 때만 한다).
 *
 * @param {{hidden:boolean, visibility:string, portrait:boolean, size:string,
 *          paused:boolean, card:boolean, defeat:boolean, ad:boolean}} state
 */
export function describeOverlay(state) {
  if (state.hidden) return `페이지가 뒤로 가 있다(visibilityState ${state.visibility}) — 틱이 멈춘다`;
  if (state.portrait) return `세로 화면 안내가 덮고 있다(${state.size}) — syncRunning이 틱을 멈춘다`;
  if (state.card) return '카드가 떠 있는데 안 내려간다';
  if (state.defeat) return '쓰러진 화면이 떠 있다';
  if (state.ad) return '광고 화면이 떠 있다';
  if (state.paused) return 'body[data-paused]는 붙어 있는데 덮은 화면이 없다';
  return null;
}

/**
 * 덮은 화면이 없을 때, 두 셈(브라우저가 그리는가 · 게임의 틱이 도는가)을 읽고 적는다.
 *
 * **다섯 갈래를 반드시 가른다.** 가운데 둘이 세션 32~34가 못 본 자리다:
 *   - 못 쟀다
 *   - 브라우저가 한 장도 안 그린다 → 브라우저가 죽었다
 *   - 브라우저는 그리는데 **게임의 틱이 한 번도 안 돈다** → `Ticker`가 섰다(게임 밖의 일)
 *   - 틱이 `STALL_FPS`(0.6fps) 위로 도는데 시계만 안 간다 → **설명이 없다. 없다고 적는다**
 *   - 틱이 `STALL_FPS` 아래로 기어간다 → 이 기계가 느리다
 *
 * @param {null | {frames:number, seconds:number, fps:number,
 *                 gameFrames:number|null, gameFps:number|null}} drawn
 */
export function describeFrames(drawn) {
  if (drawn === null) return '멈춘 화면이 없다 — 프레임을 세는 자가 안 심겼다';
  if (drawn.frames === 0) {
    return `멈춘 화면이 없는데 ${drawn.seconds.toFixed(1)}초 동안 프레임이 한 장도 안 그려졌다 — 브라우저가 멈췄다`;
  }
  const browserSide = `브라우저 ${drawn.frames}장/${drawn.seconds.toFixed(1)}초(${drawn.fps.toFixed(2)}fps)`;
  if (drawn.gameFrames === null) return `멈춘 화면이 없다 — ${browserSide} · 게임 쪽 셈이 안 심겼다`;
  if (drawn.gameFrames === 0) {
    // 한 번도 못 봤다고 "섰다"고 단정하지 않는다. 3초짜리 창으로는 0.33fps 아래를
    // 안 도는 것과 가를 수 없다 — 가를 수 없는 것을 갈랐다고 적는 것이 이 문구의 옛 병이다.
    const floor = 1 / drawn.seconds;
    return (
      `멈춘 화면이 없고 ${browserSide}인데 게임의 틱은 ${drawn.seconds.toFixed(1)}초 동안 ` +
      `한 번도 안 돌았다 — Ticker가 섰거나(main.ts syncRunning) ${floor.toFixed(2)}fps 아래로 ` +
      '기어간다. 덮은 화면은 없다고 했다'
    );
  }
  const gameSide = `게임 틱 ${drawn.gameFrames}번(${drawn.gameFps.toFixed(2)}fps)`;
  if (drawn.gameFps >= STALL_FPS) {
    // 시계는 실제 시간의 (틱 속도 × 83ms)배로 흐른다. 1배가 천장이다.
    const rate = Math.min(1, drawn.gameFps * MAX_GAME_SECONDS_PER_FRAME);
    return (
      `${gameSide}이 도는데 화면의 시계는 안 간다 (${browserSide} · 이 속도면 시계가 실제 시간의 ` +
      `${rate.toFixed(2)}배로 흘러 ${FROZEN_LIMIT}초 동안 ${(rate * FROZEN_LIMIT).toFixed(1)}초는 ` +
      `갔어야 한다) — ${describeWorld(drawn.world)}`
    );
  }
  return (
    `멈춘 화면이 없다 — ${gameSide}으로 기어간다 (${browserSide} · 게임 시간은 프레임당 ` +
    `83ms까지만 흐르므로 ${STALL_FPS.toFixed(1)}fps 아래면 시계는 ${FROZEN_LIMIT}초에 1초도 못 간다)`
  );
}

/**
 * **게임에게 직접 물은 값을 한 줄로 적는다**(세션 36).
 *
 * "틱은 44fps로 도는데 시계는 안 간다"까지 좁히고 나면 남는 갈래가 둘인데,
 * **고칠 자리가 정반대다**: 게임의 `elapsed`는 흐르는데 화면의 글자만 안 바뀌는 것(HUD 쪽)과,
 * 게임의 `elapsed` 자체가 안 느는 것(`World.step`에 닿지 못하는 것)이다.
 * 밖에서 HUD 글자만 읽는 자에게는 두 고장이 똑같이 보인다 — 그래서 게임의 입을 빌린다.
 *
 * 게임이 시계를 세우는 이유는 스스로 안다(`offer`·`defeated`). **셋 다 아니라고 하면
 * 그렇게 적는다** — 없는 이유를 지어내는 것이 세션 32~34를 헤매게 한 병이다.
 *
 * @param {null | {elapsed:number, moved:number, renders:number,
 *                 defeated:boolean, offer:boolean, paused:boolean, hp:number}} world
 */
export function describeWorld(world) {
  if (world === null || world === undefined) return '게임에게 직접 물을 길이 없다(__frameProbe가 안 심겼다)';
  const reasons = [];
  if (world.offer) reasons.push('카드가 떠 있다');
  if (world.defeated) reasons.push('쓰러졌다');
  if (world.paused && reasons.length === 0) reasons.push('isPaused만 켜져 있다');
  const said = reasons.length > 0 ? reasons.join(' · ') : '멈출 이유가 없다고 한다';
  const clock =
    world.moved > 0
      ? `제 시계는 그 사이 ${world.moved.toFixed(2)}초 갔다 — 멈춘 것은 화면의 글자다`
      : '제 시계도 안 갔다 — World.step까지 못 간다';
  return (
    `게임에게 물으니 ${world.elapsed.toFixed(2)}초 · 그리기 ${world.renders}번 · ` +
    `체력 ${world.hp.toFixed(1)} · ${clock} (${said})`
  );
}

/**
 * **재는 자가 읽는 그 글자를 그대로 보여 준다**(세션 36).
 *
 * 게임은 제 시계가 1.00배로 흐른다고 하는데 화면의 시계는 안 갔다 — 그러면 남는 것은
 * **둘 사이의 글자**다. 그 글자를 추측하지 말고 그대로 옮긴다.
 * 같은 id가 둘이면 `getElementById`는 **첫째만** 돌려주므로, 살아 있는 HUD가 둘째일 때
 * 재는 자는 영영 죽은 글자를 읽는다 — 그래서 개수도 함께 센다.
 *
 * @param {{clock:string|null, clocks:number}} state
 */
export function describeClock(state) {
  if (state.clocks === 0) return '화면에 시계(#hud-stats)가 아예 없다';
  const many =
    state.clocks > 1 ? ` · #hud-stats가 ${state.clocks}개다(재는 자는 첫째만 읽는다)` : '';
  return `재는 자가 읽는 글자는 "${state.clock}"${many}`;
}

/**
 * **이 기계가 잠들어 있던 시간을 게임 탓으로 적지 않는다(세션 38).**
 *
 * 세션 31~37은 일곱 바퀴 동안 `npm run qa`의 "서서 기다리는" 자리가 우는 까닭을 쫓았다.
 * 게임은 제 입으로 결백했고(`describeWorld`가 "멈출 이유가 없다"), 재는 자의 폴링을
 * 20분의 1로 줄여도(150ms×3회 → 500ms×1회) 통과율은 그대로였다.
 * **변수는 코드 밖에 있었다 — 이 맥이 배터리가 바닥난 채 10초마다 잠들고 있었다.**
 * (`pmset -g log`: 2026-09-13 08시 127번 · 09시 142번 `Entering Sleep state due to
 * 'Maintenance Sleep' ... Using Batt (Charge:1%)`, 그리고 10:25:55에 `Low Power Sleep`으로
 * 5시간. 전원을 꽂은 뒤 같은 검사가 240 · 122 · 295초에 세 판 연속 통과했다.)
 *
 * 잠든 기계 위에서는 **게임도 재는 자도 존재하지 않는다.** 그런데 깨어나서 시계를 보면
 * 벽시계만 훌쩍 가 있으므로, 재는 자는 그것을 "게임 시계가 멈췄다"로 적는다.
 * 그래서 **한 바퀴가 예정보다 이만큼(초) 넘게 걸리면 그 시간은 셈에서 빼고, 빼 갔다고 적는다.**
 * 5초인 이유: 평소 한 바퀴는 `POLL_MS`(500ms) + 왕복 수십 ms이고, 기계가 버거워 열 배로
 * 느려진 경우(5초)까지는 "느린 것"으로 보아 남긴다. 그 위는 프로세스가 아예 안 돌았다는 뜻이다.
 */
export const SLEEP_GAP = 5;

/**
 * 한 바퀴가 예정보다 얼마나 오래 걸렸는지를 지켜보며, 건너뛴 시간을 모은다.
 *
 * @param {number} expectedGapMs 한 바퀴에 일부러 기다리는 시간(ms). 이건 건너뛴 것이 아니다.
 * @param {{gapLimit?: number, now?: () => number}} options 검사가 시계를 넣을 수 있게 열어 둔다.
 */
export function createSleepWatch(expectedGapMs = 0, { gapLimit = SLEEP_GAP, now = Date.now } = {}) {
  let last = now();
  let slept = 0;
  let times = 0;
  let longest = 0;
  return {
    /** 한 바퀴를 돈 직후에 부른다. 건너뛴 시간(초)을 돌려준다 — 0이면 평소 속도다. */
    mark() {
      const at = now();
      const gap = (at - last - expectedGapMs) / 1000;
      last = at;
      if (!(gap > gapLimit)) return 0;
      slept += gap;
      times += 1;
      longest = Math.max(longest, gap);
      return gap;
    },
    /** 지금까지 건너뛴 시간의 합(초). 벽시계에서 이만큼을 빼야 "깨어 있던 시간"이다. */
    get slept() {
      return slept;
    },
    totals() {
      return { slept, times, longest };
    },
  };
}

/**
 * 건너뛴 시간을 한 줄로 적는다. 없으면 없다고 적는다 —
 * **"잠든 적이 없다"도 정보다**(그러면 진짜로 게임이나 브라우저 쪽을 봐야 한다).
 *
 * @param {{slept:number, times:number, longest:number}} totals
 */
export function describeSleep(totals) {
  if (totals.times === 0) return '그 사이 이 기계가 잠든 적은 없다';
  return (
    `그 사이 이 기계가 ${totals.times}번 잠들어 ${totals.slept.toFixed(0)}초를 건너뛰었다` +
    `(가장 긴 것 ${totals.longest.toFixed(0)}초) — 그만큼은 빼고 셌다`
  );
}

/**
 * 전원 상태를 한 줄로 적는다(`pmset -g batt`를 읽은 값).
 *
 * **배터리로 도는 동안의 실패는 먼저 전원을 꽂고 다시 재야 한다.** 세션 38이 그렇게 갈렸다.
 *
 * @param {null | {ac:boolean, percent:number|null, charging:boolean}} power
 */
export function describePower(power) {
  if (power === null || power === undefined) return '전원 상태는 못 읽었다';
  const charge = power.percent === null ? '' : ` ${power.percent}%`;
  if (power.ac) return `전원에 꽂혀 있다(${power.charging ? '충전 중' : '충전 안 함'}${charge})`;
  return `배터리로 돌고 있다(${charge.trim()}) — 바닥나면 이 맥은 10초마다 잠든다(세션 38)`;
}
