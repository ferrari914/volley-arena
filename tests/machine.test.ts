import { describe, expect, it } from 'vitest';
import {
  STARVED_SHARE,
  WARN_SHARE,
  describeShare,
  measureCpuShare,
  verdictOf,
} from './support/machine';
import {
  HEAVY_SHARE,
  adviceFor,
  describeSleep,
  lateBy,
  stallShare,
} from './support/sleepWatch';
import {
  describeMissing,
  didRun,
  missingModules,
  shortName,
} from './support/ranAll';

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

  it('멈춘 몫은 벽시계에 견주어 세고, 벽시계가 0이어도 터지지 않는다', () => {
    expect(stallShare(945_000, 904_000)).toBeCloseTo(0.9566, 4);
    expect(stallShare(0, 0)).toBe(0);
    // 마지막 박동 뒤의 구멍을 뒤늦게 더하다 보면 벽시계를 조금 넘길 수 있다. 1이 천장이다.
    expect(stallShare(100, 200)).toBe(1);
  });
});

/**
 * **뭐라고 적어 주는지를 잰다.** 이 묶음이 있는 까닭은 세션 112가 겪은 고장이다 —
 * 이 자가 "빨개진 검사를 따로 돌려 보라, 대개 통과한다"고 적어 두었는데,
 * 잠이 98%인 바퀴에서는 따로 돌려도 또 빨개진다(실제로 35분을 더 써서 확인했다).
 * 틀린 안내는 없는 안내보다 나쁘므로, **선 위아래로 말이 갈리는지를 검사로 박아 둔다.**
 */
describe('멈춘 기계에 뭐라고 적어 주는가', () => {
  const joined = (wallMs: number, lostMs: number): string => adviceFor(wallMs, lostMs).join('\n');

  it('더러 자는 바퀴에는 따로 돌려 보라고 적는다 (60초 중 30초)', () => {
    const said = joined(60_000, 30_000);
    expect(said).toContain('따로 돌려 보라');
    expect(said).toContain('대개 통과한다');
  });

  it('거의 다 자는 바퀴에는 돌리기 전에 기계부터 보라고 적는다 (세션 112의 3191초 중 3142초)', () => {
    const said = joined(3_191_000, 3_142_000);
    expect(said).toContain('또 빨개진다');
    expect(said).toContain('기계부터 보라');
    expect(said).toContain('98.5%');
    // 여기서 이 말이 나오면 다음 바퀴가 또 35분을 버린다.
    expect(said).not.toContain('대개 통과한다');
  });

  it('세션 99의 바퀴(945초 중 904초)도 같은 쪽이다 — 그때 통과한 것은 운이었다', () => {
    expect(joined(945_000, 904_000)).toContain('기계부터 보라');
  });

  it('따로 돌려 본 그 판(2089초 중 2041초)도 같은 쪽으로 갈린다', () => {
    expect(joined(2_089_000, 2_041_000)).toContain('또 빨개진다');
  });

  it('선 위아래가 정확히 갈린다 (선이 흔들리면 이 자는 쓸모가 없다)', () => {
    const wall = 1_000_000;
    expect(joined(wall, wall * HEAVY_SHARE)).toContain('또 빨개진다');
    expect(joined(wall, wall * HEAVY_SHARE - 1_000)).toContain('대개 통과한다');
  });

  it('어느 쪽이든 게임을 의심하지 말라는 말은 빠지지 않는다', () => {
    for (const said of [joined(945_000, 904_000), joined(3_191_000, 3_142_000)]) {
      expect(said).toContain('게임');
    }
  });
});

/**
 * **안 돈 검사 파일을 세는 자** (세션 114 · 바퀴 #436).
 * 여기도 판단과 재는 일을 나눴다 — 일꾼을 굶겨 파일을 못 열게 하는 상황은 손으로 만들 수
 * 없으므로, **무슨 말을 적을지는 아래 손으로 박은 값이 보증한다.**
 * 값은 지어낸 것이 아니라 바퀴 #436에서 실제로 본 것이다(18개 중 9개가 안 돌았다).
 */
describe('안 돈 검사 파일을 어떻게 세는가 (손으로 박은 값)', () => {
  it('결과를 낸 것만 돌았다고 센다 — queued·pending은 열리지도 않은 것이다', () => {
    expect(didRun('passed')).toBe(true);
    expect(didRun('failed')).toBe(true);
    expect(didRun('skipped')).toBe(true);
    expect(didRun('queued')).toBe(false);
    expect(didRun('pending')).toBe(false);
  });

  it('열기로 한 순서 그대로, 결과를 못 낸 것만 골라낸다', () => {
    expect(missingModules(['a', 'b', 'c'], ['c', 'a'])).toEqual(['b']);
    expect(missingModules(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('절대 경로에서 저장소 안 이름만 남긴다', () => {
    expect(shortName('/Users/x/화살 게임 개발/tests/maps.test.ts')).toBe('tests/maps.test.ts');
    // `tests/` 밖이면 마지막 두 칸만 남긴다 (자를 증명하며 실제로 겪은 경우다)
    expect(shortName('/Users/x/화살 게임 개발/tmp-proof/bb.test.mjs')).toBe('tmp-proof/bb.test.mjs');
    expect(shortName('가상/이름')).toBe('가상/이름');
  });

  it('다 돌았으면 아무 말도 하지 않는다', () => {
    expect(describeMissing(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('바퀴 #436이 겪은 그 표에는 빠진 수와 빠진 이름이 함께 적힌다', () => {
    const planned = Array.from({ length: 18 }, (_, i) => `/repo/tests/f${i}.test.ts`);
    const ran = planned.slice(0, 9);
    const said = describeMissing(planned, ran).join('\n');

    expect(said).toContain('18개 중 9개가 아예 시작되지 못했다');
    // 실제로 돈 수를 함께 적는다. vitest 표의 낱말을 인용하지는 않는다 —
    // 같은 사건에서도 표는 '9 passed (9)'였다가 '1 failed (2)'였다(bail로 끊긴 경우).
    expect(said).toContain('실제로 돈 것은 18개 중 9개다');
    expect(said).toContain('tests/f9.test.ts');
    expect(said).not.toContain('tests/f0.test.ts');
    // 까닭을 여기서 새로 판정하지 않는다 — 잠 판정은 `[기계]` 줄의 몫이다.
    expect(said).toContain('[기계]');
  });
});
