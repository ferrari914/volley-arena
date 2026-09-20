import { describe, expect, it } from 'vitest';
import {
  STARVED_SHARE,
  WARN_SHARE,
  describeShare,
  measureCpuShare,
  verdictOf,
} from './support/machine';
import { describeSleep, lateBy } from './support/sleepWatch';

/**
 * **이 파일은 게임을 재지 않는다. 이 검사를 돌리는 기계가 굶고 있는지를 잰다.**
 * 왜 이런 자가 필요한지는 `tests/support/machine.ts`의 머리말에 있다(세 번 겪은 고장이다).
 *
 * 판단(`verdictOf`)과 재는 일(`measureCpuShare`)을 나눠 두었다.
 * **판단은 손으로 박은 값으로 검사하고**(아래 첫 묶음), 재는 일은 실제 기계에 물어본다.
 * 기계를 굶기는 상황은 손으로 만들 수 없기 때문이다 — 세션 98이 CPU를 40갈래로 나눠
 * load 22까지 올려 봤지만 macOS가 뒤쪽 일을 먼저 미뤄서 몫이 선 아래로 내려가지 않았다.
 * 그러니 **선이 제대로 작동하는지는 아래 첫 묶음이 보증하고**, 두 번째 묶음은 지금 이
 * 바퀴의 표를 믿어도 되는지를 본다.
 */

describe('굶은 정도를 무엇이라 부르는가 (손으로 박은 값)', () => {
  it('실제로 겪은 사건(세션 98의 2.7%)은 굶은 것으로 잡힌다', () => {
    expect(verdictOf(0.027)).toBe('starved');
  });

  it('CPU를 온전히 쓰는 기계는 성한 것으로 본다', () => {
    expect(verdictOf(1)).toBe('ok');
    expect(verdictOf(0.95)).toBe('ok');
  });

  it('평범하게 바쁜 기계는 빨갛게 하지 않고 알리기만 한다', () => {
    expect(verdictOf(0.3)).toBe('busy');
    expect(verdictOf(0.2)).toBe('busy');
  });

  it('두 선 위아래가 정확히 갈린다 (선 자체가 흔들리면 이 자는 쓸모가 없다)', () => {
    expect(verdictOf(STARVED_SHARE)).toBe('busy');
    expect(verdictOf(STARVED_SHARE - 0.001)).toBe('starved');
    expect(verdictOf(WARN_SHARE)).toBe('ok');
    expect(verdictOf(WARN_SHARE - 0.001)).toBe('busy');
  });

  it('사람이 읽을 줄에 몫과 늘어나는 배수가 함께 있다', () => {
    expect(describeShare(0.5)).toBe('CPU 몫 50.0% (벽시계가 계산량의 2.0배)');
  });
});

describe('이 검사를 돌리는 기계', () => {
  it('CPU를 제대로 얻고 있다 (굶고 있으면 이 바퀴의 시간 초과는 게임 탓이 아니다)', () => {
    const share = measureCpuShare();
    const verdict = verdictOf(share);

    if (verdict === 'busy') {
      console.warn(
        `[기계] ${describeShare(share)} — 시간 초과가 났다면 게임이 아니라 기계를 먼저 의심하라.`,
      );
    }

    expect(
      verdict,
      `기계가 굶었다 (${describeShare(share)}). 이 바퀴에 시간 초과가 났다면 게임이 깨진 것이 ` +
        '아니라 기계가 CPU를 못 얻은 것이다. 코드를 파기 전에 기계부터 보라 ' +
        '(load average · 스왑 · 다른 무거운 프로세스). 빨개진 검사를 따로 돌리면 대개 통과한다.',
    ).not.toBe('starved');
  });
});

/**
 * 잠든 구멍을 세는 셈(`tests/support/sleepWatch.ts`). 기계를 재우는 일은 손으로 못 하니
 * 셈만 손으로 박은 값으로 검사한다. **실제로 통하는지는 세션 99가 재서 확인했다** —
 * 기계가 99초·50초 잠든 것을 박동이 97.7초·49.2초로 잡아냈다.
 */
describe('잠든 구멍을 세는 셈', () => {
  it('제때 온 박동은 구멍이 아니다', () => {
    expect(lateBy(1_000)).toBe(0);
    expect(lateBy(1_200)).toBe(0);
  });

  it('조금 늦은 박동은 바쁜 기계일 뿐이라 세지 않는다', () => {
    expect(lateBy(3_500)).toBe(0);
  });

  it('한참 늦은 박동은 그 사이 멈춰 있던 시간으로 센다', () => {
    // 100초 만에 온 박동이면 1초는 제 몫이고 99초가 구멍이다.
    expect(lateBy(100_000)).toBe(99_000);
  });

  it('실제로 겪은 구멍(945초 중 904초)을 사람이 읽을 줄로 적는다', () => {
    expect(describeSleep(945_000, 904_000)).toBe(
      '이 바퀴 동안 기계가 904초 멈춰 있었다. 벽시계 945초 중 실제로 일한 것은 41초다.',
    );
  });
});
