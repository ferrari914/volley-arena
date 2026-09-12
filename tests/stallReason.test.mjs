/**
 * 시계가 섰을 때 재는 자가 뭐라고 적는가(`tools/lib/stallReason.mjs`).
 *
 * **왜 문구에 검사를 다는가.** 이 문구는 사람이 읽는 한 줄이지만, 그 한 줄이 다음 바퀴가
 * 어디를 팔지를 정한다. 세션 32~34가 세 바퀴 동안 이 기계의 느림을 쫓은 것은
 * 문구가 이렇게 적혀 있었기 때문이다:
 *
 *   `브라우저가 3.0초에 106장만 그린다 (35.13fps · ... 0.6fps 아래면 시계는 20초에 1초도 못 간다)`
 *
 * **제 숫자와 제 말이 어긋나 있다** — 35fps는 0.6fps 아래가 아니다. 그런데 읽는 사람에게는
 * "브라우저가 못 그린다"만 남는다. 이런 어긋남은 사람이 매번 잡아낼 수 없다(세 바퀴가 못 잡았다).
 * 그래서 **"적은 말과 잰 숫자가 같은 것을 가리키는가"를 기계가 잰다.**
 */
import { describe, expect, it } from 'vitest';
import {
  describeFrames,
  describeOverlay,
  FROZEN_LIMIT,
  MAX_GAME_SECONDS_PER_FRAME,
  STALL_FPS,
} from '../tools/lib/stallReason.mjs';
import { Ticker } from '../src/core/Ticker.ts';

/** 아무것도 덮지 않은 화면. 검사마다 필요한 칸만 켠다. */
const CLEAR = {
  hidden: false,
  visibility: 'visible',
  portrait: false,
  size: '844x390',
  paused: false,
  card: false,
  defeat: false,
  ad: false,
};

/** 브라우저는 도는데 게임 틱만 `gameFps`로 도는 3초짜리 측정 한 건. */
function measured(gameFps, browserFps = 60) {
  const seconds = 3;
  return {
    frames: Math.round(browserFps * seconds),
    seconds,
    fps: browserFps,
    gameFrames: Math.round(gameFps * seconds),
    gameFps,
  };
}

describe('멈춘 이유 — 덮은 화면', () => {
  it('덮은 것이 없으면 null을 돌려준다 (그때만 프레임을 세러 간다)', () => {
    expect(describeOverlay(CLEAR)).toBeNull();
  });

  it('페이지가 뒤로 가 있으면 그것부터 말한다 — 틱 자체가 멈추는 자리다', () => {
    const why = describeOverlay({ ...CLEAR, hidden: true, visibility: 'hidden', card: true });
    expect(why).toContain('페이지가 뒤로 가 있다');
    expect(why).toContain('hidden');
  });

  it('세로 화면 안내는 body[data-paused] 없이도 잡힌다 — 이쪽이 세션 35가 뚫린 구멍이다', () => {
    // syncRunning의 나머지 반쪽. paused 표시를 붙이지 않으므로 paused만 보면 영영 안 보인다.
    expect(describeOverlay({ ...CLEAR, portrait: true })).toContain('세로 화면 안내');
  });

  it('덮은 화면들은 정해진 차례로 말한다 (카드 → 쓰러짐 → 광고 → 이름 없는 멈춤)', () => {
    expect(describeOverlay({ ...CLEAR, card: true, defeat: true })).toContain('카드');
    expect(describeOverlay({ ...CLEAR, defeat: true, ad: true })).toContain('쓰러진 화면');
    expect(describeOverlay({ ...CLEAR, ad: true })).toContain('광고 화면');
    expect(describeOverlay({ ...CLEAR, paused: true })).toContain('덮은 화면이 없다');
  });
});

describe('멈춘 이유 — 두 셈(브라우저 · 게임 틱)', () => {
  it('못 쟀으면 못 쟀다고 적는다', () => {
    expect(describeFrames(null)).toContain('세는 자가 안 심겼다');
    expect(describeFrames({ ...measured(30), gameFrames: null, gameFps: null })).toContain(
      '게임 쪽 셈이 안 심겼다',
    );
  });

  it('브라우저가 한 장도 안 그렸으면 브라우저가 멈춘 것이다', () => {
    expect(describeFrames({ frames: 0, seconds: 3, fps: 0, gameFrames: 0, gameFps: 0 })).toContain(
      '브라우저가 멈췄다',
    );
  });

  it('브라우저는 도는데 게임 틱이 0이면 Ticker 쪽을 가리킨다', () => {
    const why = describeFrames(measured(0));
    expect(why).toContain('Ticker가 섰거나');
  });

  it('한 번도 못 본 것을 "섰다"로 단정하지 않는다 — 3초 창은 0.33fps 아래를 못 가른다', () => {
    // 0.05fps로 기어가는 화면도 3초 안에는 한 번도 안 돈다. 두 고장은 고칠 자리가 정반대라
    // (게임 밖의 틱 · 느린 기계), 가를 수 없을 때는 둘 다 이름을 대야 한다.
    const why = describeFrames(measured(0));
    expect(why).toContain('0.33fps 아래로 기어간다');
  });
});

describe('세션 32~34를 헤매게 한 문구가 다시 나오지 않는다', () => {
  it('35fps가 도는데 "기어간다"고 적지 않는다 — 그 속도면 시계는 흘렀어야 한다', () => {
    const why = describeFrames(measured(35, 35.13));
    expect(why).toContain('앞뒤가 안 맞는다');
    expect(why).not.toContain('기어간다');
    expect(why).not.toContain('1초도 못 간다');
  });

  it('"기어간다"는 정말로 시계가 설 수 있는 속도에서만 적는다', () => {
    // 3초 창이 한 번은 볼 수 있는 속도(0.34fps)부터 60fps까지 훑어,
    // 적은 말과 잰 숫자가 같은 것을 가리키는지 본다. 그 아래는 위 검사가 따로 본다.
    for (let fps = 0.34; fps <= 60; fps += 0.02) {
      const why = describeFrames(measured(fps));
      // 이 속도로 FROZEN_LIMIT초를 돌면 게임 시계가 실제로 몇 초 가는가.
      const moves = Math.min(1, fps * MAX_GAME_SECONDS_PER_FRAME) * FROZEN_LIMIT;
      // 시계는 초 단위로만 적히므로, 1초를 못 넘기면 재는 자에게는 선 것으로 보인다.
      if (moves < 1) expect(why, `${fps.toFixed(2)}fps`).toContain('기어간다');
      else expect(why, `${fps.toFixed(2)}fps`).toContain('앞뒤가 안 맞는다');
    }
  });

  it('설명이 없는 자리에서는 있는 척하지 않고 얼마나 갔어야 하는지를 적는다', () => {
    // 5fps면 시계는 실제의 0.42배로 흘러 20초 창에서 8.3초가 갔어야 한다. 그런데 안 갔다.
    const why = describeFrames(measured(5));
    expect(why).toContain('0.42배');
    expect(why).toContain('8.3초는 갔어야 한다');
  });
});

describe('선을 긋는 값이 게임과 재는 자에게서 나온다', () => {
  it('한 프레임에 흐르는 게임 시간의 천장이 Ticker의 값과 같다', () => {
    // 게임이 fixedDt·maxSteps를 바꾸면 이 문구의 "83ms"가 조용히 거짓이 된다.
    const ticker = new Ticker(
      () => {},
      () => {},
    );
    expect(MAX_GAME_SECONDS_PER_FRAME).toBeCloseTo(ticker.fixedDt * ticker.maxSteps, 10);
  });

  it('설 수 있는 속도는 재는 자의 창(FROZEN_LIMIT)에서 계산된 값이다', () => {
    expect(STALL_FPS).toBeCloseTo(0.6, 10);
    // 이 속도로 창을 꽉 채우면 시계는 정확히 1초 간다 — 그것이 선의 정의다.
    expect(STALL_FPS * FROZEN_LIMIT * MAX_GAME_SECONDS_PER_FRAME).toBeCloseTo(1, 10);
  });
});
