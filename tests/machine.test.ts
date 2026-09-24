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
  FAST_AT,
  FAST_NS,
  SLOW_AT,
  SLOW_NS,
  STALE_AT,
  coreAdviceFor,
  coreVerdictOf,
  describeCore,
  measureCoreRate,
  nsPerIter,
  slowdownVs,
} from './support/coreSpeed';
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
  /**
   * **이 일꾼이 빠른 코어에 앉았는지를 적는다** (세션 117 · 바퀴 #517).
   * 빨갛게 하지 않는다 — 느린 코어는 고장이 아니고 사람이 이 기계를 쓰는 중이라는 뜻일 뿐이다.
   * 없던 것은 이름표다: 이 줄이 없으면 다음 세션이 "50초"를 보고 게임을 파거나
   * 그 초를 새 평소로 베껴 적는다. 내력은 `tests/support/coreSpeed.ts`의 머리말에 있다.
   *
   * **재는 곳이 한 일꾼이라는 것은 알고 적는다** — 이 파일을 맡은 일꾼의 코어이고,
   * 벽시계를 정하는 것은 가장 오래 가는 파일(`tests/maps.test.ts`)의 일꾼이다.
   * 둘은 같은 정책으로 배치되므로 이 값은 그 일꾼의 처지를 가리키는 표지로 쓴다.
   */
  it('빠른 코어에 앉아 있다 (느린 코어면 이 바퀴의 초는 앞 기록과 견줄 수 없다)', () => {
    const ns = measureCoreRate();
    const said = coreAdviceFor(ns);

    if (said.length > 0) console.warn(['', ...said, ''].join('\n'));

    // 빨갛게 하지 않는다. 값이 값으로 나왔는지만 본다 — 0이 나오면 재는 쪽이 망가진 것이다.
    expect(ns).toBeGreaterThan(0);
  });

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

/**
 * **얻은 코어를 무엇이라 부르는가** (세션 117 · 바퀴 #517).
 * 여기도 판단과 재는 일을 나눴다 — 일꾼을 효율 코어로 밀어내는 일은 검사 안에서 못 하지만
 * (`taskpolicy -b`는 프로세스를 새로 띄워야 한다), **무슨 말을 적을지는 손으로 박은 값으로 잰다.**
 * 값은 지어낸 것이 아니라 세션 117이 이 기계에서 실제로 잰 것이다
 * (그냥 0.62 ns/회 · `taskpolicy -b` 1.93 ns/회 · 셋씩 재서 ±8% 안).
 */
describe('얻은 코어를 무엇이라 부르는가 (손으로 박은 값)', () => {
  it('실제로 잰 두 값이 각자의 이름으로 갈린다', () => {
    expect(coreVerdictOf(0.62)).toBe('fast');
    expect(coreVerdictOf(1.93)).toBe('slow');
  });

  it('선 위아래가 정확히 갈린다 (선이 흔들리면 이 자는 쓸모가 없다)', () => {
    expect(coreVerdictOf(STALE_AT - 0.001)).toBe('stale');
    expect(coreVerdictOf(STALE_AT)).toBe('fast');
    expect(coreVerdictOf(FAST_AT)).toBe('fast');
    expect(coreVerdictOf(FAST_AT + 0.001)).toBe('mixed');
    expect(coreVerdictOf(SLOW_AT - 0.001)).toBe('mixed');
    expect(coreVerdictOf(SLOW_AT)).toBe('slow');
  });

  it('클럭이 흔들려 조금 느린 것은 느린 코어로 부르지 않는다 (0.62의 1.4배)', () => {
    expect(coreVerdictOf(FAST_NS * 1.4)).toBe('fast');
  });

  it('계산 한 번의 값은 계산량과 무관한 단위로 나온다', () => {
    // 세션 117이 실제로 본 판: 3억 번이 186ms였다.
    expect(nsPerIter(186, 3e8)).toBeCloseTo(0.62, 2);
    // 0으로 나누지 않는다.
    expect(nsPerIter(100, 0)).toBe(0);
  });

  it('사람이 읽을 줄에 속도와 늘어나는 배수가 함께 있다', () => {
    expect(slowdownVs(SLOW_NS)).toBeCloseTo(3.11, 2);
    expect(describeCore(1.93)).toBe(
      '1.93 ns/회 (빠른 코어의 3.1배 · 이 일꾼의 일이 그만큼 오래 걸린다)',
    );
  });

  it('빠른 코어에서는 아무 말도 하지 않는다 (할 말 없을 때 조용한 것이 세션 116의 약이다)', () => {
    expect(coreAdviceFor(FAST_NS)).toEqual([]);
  });

  it('느린 코어에는 게임을 파지 말라는 말과 초를 베끼지 말라는 말이 함께 적힌다', () => {
    const said = coreAdviceFor(SLOW_NS).join('\n');
    expect(said).toContain('게임을 파지 마라');
    // 세션 114가 금지한 길 — 이 말이 빠지면 다음 세션이 이 초를 새 평소로 적는다.
    expect(said).toContain('"평소"로 적지 마라');
    // 앞선 자 셋이 모두 성하다고 답한다는 것까지 적어야 다음 세션이 그 셋을 다시 안 뒤진다.
    expect(said).toContain('CPU 몫');
    expect(said).toContain('[기계]');
    // 배수를 검사 전체의 초에 곱하면 또 틀린 수가 기록으로 넘어간다 (세션 117이 실제로 본
    // 두 판이 2.6배/37.4초 · 1.0배/29.8초다 — 곱셈이 맞지 않는다).
    expect(said).toContain('그대로 곱하지 마라');
  });

  it('섞여 돌은 바퀴에는 초를 베끼지 말라는 말까지는 하지 않는다 (덜 확실하므로)', () => {
    const said = coreAdviceFor((FAST_AT + SLOW_AT) / 2).join('\n');
    expect(said).toContain('게임을 파지 마라');
    expect(said).not.toContain('"평소"로 적지 마라');
  });

  it('기계가 바뀌면 기준값을 다시 재라고 말한다 (게임 탓으로 읽히지 않게)', () => {
    const said = coreAdviceFor(0.2).join('\n');
    expect(said).toContain('기준값이 썩었다');
    expect(said).toContain('coreSpeed.ts');
    expect(said).toContain('게임과는 무관하다');
  });

  /**
   * **말을 했으면 다음 세션이 찾으라고 배운 이름으로 해야 한다** (세션 119 · 바퀴 #521).
   *
   * 세션 117은 STATUS에 "검사 초를 적기 전에 `[코어]` 줄이 있는지부터 보라"고 남겼는데,
   * 그 이름표가 `stale` 갈래에만 붙어 있었다 — **정작 봐야 할 `slow`·`mixed`는 이름 없이 떴다.**
   * 세션 119가 바로 걸렸다: 세 이름표를 `grep`해 하나도 안 나오자 50.1초를 "세 줄 다 없음"으로
   * 적을 뻔했고, 그때 출력에는 1.9배짜리 느린 코어 경고가 그대로 찍혀 있었다.
   * 그러면 `coreSpeed.ts`가 막으려던 바로 그 일(세션 114가 금지한 "초를 베껴 적기")이 일어난다.
   *
   * 그래서 갈래를 하나씩 세지 않고 **ns를 훑어서 잰다** — 갈래를 새로 더해도 이 검사에 걸린다
   * (갈래마다 한 줄씩 적는 검사는 새 갈래가 생기면 조용히 비켜 간다 · 세션 116이 고친 그 꼴이다).
   */
  it('말하는 갈래는 모두 첫 줄에 `[코어]`를 단다 (ns를 훑어서 잰다)', () => {
    const spoke: string[] = [];
    for (let ns = 0.05; ns <= 6; ns += 0.05) {
      const said = coreAdviceFor(ns);
      if (said.length === 0) continue;
      const head = said[0] ?? '';
      spoke.push(head);
      expect(head).toContain('[코어]');
    }
    // 훑은 범위가 실제로 말하는 갈래를 다 지났는지까지 본다 (조용하기만 했으면 이 검사는 무의미하다).
    expect(new Set(spoke.map((line) => line.slice(0, 40))).size).toBeGreaterThanOrEqual(3);
  });

  it('세션 119가 걸린 그 두 갈래에 이름표가 있다 (느린 코어 · 섞인 코어)', () => {
    // `?? ''`로 받으면 빈 갈래가 조용히 통과하므로, 말을 했는지부터 따로 잰다.
    const slow = coreAdviceFor(SLOW_NS);
    const mixed = coreAdviceFor((FAST_AT + SLOW_AT) / 2);
    expect(slow.length).toBeGreaterThan(0);
    expect(mixed.length).toBeGreaterThan(0);
    expect(slow[0] ?? '').toContain('[코어]');
    expect(mixed[0] ?? '').toContain('[코어]');
  });

  it('조용한 갈래는 이름표도 남기지 않는다 (세션 116의 약이 이 이름표로 깨지지 않는다)', () => {
    expect(coreAdviceFor(FAST_NS).join('\n')).not.toContain('[코어]');
  });
});
