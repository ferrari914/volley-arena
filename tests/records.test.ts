import { describe, expect, it } from 'vitest';
import { isBetter, readBest, submitRun, type RecordStorage } from '../src/data/records';

/** 진짜 localStorage 없이 규칙을 재기 위한 가짜 저장소. */
function fakeStorage(initial?: string): RecordStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(): string | null {
      return this.value;
    },
    setItem(_key: string, next: string): void {
      this.value = next;
    },
  };
}

const run = (level: number, kills: number, time: number, revives = 0) => ({
  level,
  kills,
  time,
  revives,
});

describe('최고 기록 저장 (DESIGN 7번)', () => {
  it('첫 판이 그대로 최고 기록이 된다', () => {
    const storage = fakeStorage();
    const outcome = submitRun(run(5, 21, 39), storage);

    expect(outcome.isNew).toBe(true);
    expect(outcome.saved).toBe(true);
    expect(outcome.best).toEqual({ level: 5, kills: 21, time: 39 });
    expect(readBest(storage)).toEqual({ level: 5, kills: 21, time: 39 });
  });

  it('더 멀리 간 판이 기록을 갈아치운다', () => {
    const storage = fakeStorage();
    submitRun(run(5, 21, 39), storage);
    const outcome = submitRun(run(8, 30, 61), storage);

    expect(outcome.isNew).toBe(true);
    expect(readBest(storage)).toEqual({ level: 8, kills: 30, time: 61 });
  });

  it('못 미치는 판은 기록을 건드리지 않는다', () => {
    const storage = fakeStorage();
    submitRun(run(8, 30, 61), storage);
    const outcome = submitRun(run(3, 9, 120), storage);

    expect(outcome.isNew).toBe(false);
    expect(outcome.best).toEqual({ level: 8, kills: 30, time: 61 });
    expect(readBest(storage)).toEqual({ level: 8, kills: 30, time: 61 });
  });

  it('레벨이 먼저고, 같으면 처치 수, 그다음이 생존 시간이다', () => {
    // 오래 버티기만 한 판이 잘 싸운 판을 이기면 기록이 "도망친 시간"을 가리키게 된다.
    expect(isBetter({ level: 6, kills: 2, time: 30 }, { level: 5, kills: 40, time: 200 })).toBe(true);
    expect(isBetter({ level: 5, kills: 41, time: 30 }, { level: 5, kills: 40, time: 200 })).toBe(true);
    expect(isBetter({ level: 5, kills: 40, time: 201 }, { level: 5, kills: 40, time: 200 })).toBe(true);
    expect(isBetter({ level: 5, kills: 40, time: 200 }, { level: 5, kills: 40, time: 200 })).toBe(false);
  });

  it('이어하기로 이어 간 판은 아무리 멀리 가도 기록에 오르지 않는다', () => {
    // 광고를 본 만큼 기록이 자라면 그 숫자는 "얼마나 잘했는가"를 뜻하지 않게 된다.
    const storage = fakeStorage();
    submitRun(run(5, 21, 39), storage);
    const outcome = submitRun(run(20, 200, 600, 3), storage);

    expect(outcome.ranked).toBe(false);
    expect(outcome.isNew).toBe(false);
    expect(outcome.saved).toBe(false);
    // 지난 기록은 그대로 보여 준다 — 견줄 것이 사라지면 결과 화면이 반쪽이 된다.
    expect(outcome.best).toEqual({ level: 5, kills: 21, time: 39 });
    expect(readBest(storage)).toEqual({ level: 5, kills: 21, time: 39 });
  });

  it('저장된 값이 깨져 있으면 없는 셈 치고 다음 판이 덮는다', () => {
    for (const broken of ['{', 'null', '"3"', '{"level":"다섯","kills":1,"time":1}', '{"kills":1}']) {
      const storage = fakeStorage(broken);
      expect(readBest(storage)).toBeNull();
      expect(submitRun(run(2, 3, 4), storage).isNew).toBe(true);
      expect(readBest(storage)).toEqual({ level: 2, kills: 3, time: 4 });
    }
  });

  it('저장이 막힌 브라우저(사파리 프라이빗)에서도 예외가 새어 나가지 않는다', () => {
    // 여기서 예외가 나면 쓰러진 화면이 뜨지 않아 판에서 빠져나갈 길이 없어진다.
    const blocked: RecordStorage = {
      getItem(): string | null {
        throw new Error('SecurityError');
      },
      setItem(): void {
        throw new Error('QuotaExceededError');
      },
    };

    expect(readBest(blocked)).toBeNull();
    const outcome = submitRun(run(5, 21, 39), blocked);
    expect(outcome.saved).toBe(false);
    // 저장은 못 해도 이번 판이 지금까지 본 최고라는 사실은 그대로다.
    expect(outcome.isNew).toBe(true);
    expect(outcome.best).toEqual({ level: 5, kills: 21, time: 39 });
  });

  it('저장소 자체가 없어도(null) 결과 화면이 채워진다', () => {
    // 저장이 안 되는 것과 화면이 비는 것은 다른 문제다. 못 남길 뿐 이번 판은 보여 준다.
    expect(readBest(null)).toBeNull();
    expect(submitRun(run(1, 0, 3), null)).toEqual({
      best: { level: 1, kills: 0, time: 3 },
      isNew: true,
      ranked: true,
      saved: false,
    });
  });
});
