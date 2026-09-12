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
      `앞뒤가 안 맞는다 — ${gameSide}이 도는데 시계는 안 간다 (${browserSide}). ` +
      `이 속도면 시계가 실제 시간의 ${rate.toFixed(2)}배로 흘러 ` +
      `${FROZEN_LIMIT}초 동안 ${(rate * FROZEN_LIMIT).toFixed(1)}초는 갔어야 한다`
    );
  }
  return (
    `멈춘 화면이 없다 — ${gameSide}으로 기어간다 (${browserSide} · 게임 시간은 프레임당 ` +
    `83ms까지만 흐르므로 ${STALL_FPS.toFixed(1)}fps 아래면 시계는 ${FROZEN_LIMIT}초에 1초도 못 간다)`
  );
}
