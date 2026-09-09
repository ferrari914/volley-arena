/**
 * 최고 기록 저장 (DESIGN 7번 — 결과 화면 + 기록 저장).
 *
 * **localStorage를 만지는 코드는 이 파일 하나뿐이다.** 여기저기서 직접 만지면
 * 키 이름과 저장 형식이 갈라지고, 아래의 두 함정을 각자 다시 밟게 된다.
 *
 *   ① 사파리 프라이빗 모드에서는 `localStorage` 접근과 `setItem`이 **예외를 던진다.**
 *      try/catch 없이 부르면 그 브라우저에서는 죽은 뒤에 화면이 그대로 멈춘다.
 *      기록을 못 남기는 것은 사소한 일이고, 게임이 멈추는 것은 치명적인 고장이다.
 *      그래서 이 파일의 모든 입출구는 실패해도 게임을 세우지 않는다.
 *   ② 저장된 값은 **사용자가 고칠 수 있고 옛 형식일 수도 있다.** 숫자가 아닌 것이
 *      들어 있으면 화면에 NaN이 뜬다. 읽을 때 형식을 확인하고, 이상하면 없는 셈 친다.
 *
 * ## 무엇을 최고 기록으로 세는가
 *
 * **이어하기(광고 부활)로 이어 간 판은 최고 기록에 올리지 않는다.**
 * 광고를 볼 때마다 같은 판이 계속 자라므로, 세어 주면 기록은 "얼마나 잘했는가"가 아니라
 * "광고를 몇 번 봤는가"가 된다. 그러면 기록은 다시 볼 이유가 없는 숫자가 된다.
 * 이어한 판도 결과 화면에는 그대로 다 보여 주고(그 판을 부정하지 않는다),
 * 기록 줄에만 올리지 않는다 — 이어하기는 더 놀기 위한 것이지 기록을 사는 것이 아니다.
 */

/** 한 판의 결과. DESIGN 7번이 요구하는 세 값이다. */
export interface RunRecord {
  /** 도달 레벨. */
  level: number;
  /** 처치 수. */
  kills: number;
  /** 생존 시간(s). */
  time: number;
}

/** 방금 끝난 판. 기록에 올릴지 판단하는 데 `revives`가 필요하다. */
export interface RunResult extends RunRecord {
  /** 이어하기(광고 부활) 횟수. */
  revives: number;
}

export interface RecordOutcome {
  /** 지금까지의 최고 기록. 한 번도 없으면 null. */
  best: RunRecord | null;
  /**
   * 이번 판을 제출하기 **직전의** 최고 기록. 한 번도 없었으면 null.
   * 기록을 갈아치웠을 때 "무엇을 넘어섰는가"를 보여 주는 데 쓴다 —
   * 그 줄이 없으면 결과 화면이 같은 숫자를 두 번 적게 된다.
   */
  previous: RunRecord | null;
  /** 이번 판이 그 최고 기록을 갈아치웠는가. */
  isNew: boolean;
  /** 이번 판이 기록 경쟁에 낀 판인가(= 이어하기 없이 끝냈는가). */
  ranked: boolean;
  /** 이번 판이 실제로 브라우저에 저장됐는가. 프라이빗 모드에서는 false. */
  saved: boolean;
}

/**
 * 저장소의 최소 모양. localStorage가 이 모양을 그대로 만족한다.
 * 인터페이스로 받는 이유는 테스트가 진짜 브라우저 없이 이 규칙을 검사하기 위해서다.
 */
export interface RecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 저장 키. 뒤의 `v1`은 형식 번호다 — 나중에 저장 내용이 바뀌면 키를 올려서
 * 옛 값과 섞이지 않게 한다(옛 값은 읽히지 않고 그대로 남았다가 잊힌다).
 */
const KEY = 'volley-arena:best:v1';

/** 브라우저의 localStorage. 접근 자체가 막힌 환경에서는 null. */
export function browserStorage(): RecordStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 두 판을 견준다. 레벨이 먼저고, 같으면 처치 수, 그다음이 생존 시간이다.
 *
 * 레벨을 앞에 둔 이유: 이 게임에서 오래 버티는 것은 도망 다니면 되지만
 * 레벨은 적을 잡아야 오른다(DESIGN 3번). 기록이 "잘 싸운 판"을 가리켜야 한다.
 */
export function isBetter(run: RunRecord, than: RunRecord): boolean {
  if (run.level !== than.level) return run.level > than.level;
  if (run.kills !== than.kills) return run.kills > than.kills;
  return run.time > than.time;
}

/** 저장된 최고 기록. 없거나 형식이 깨졌으면 null. */
export function readBest(storage: RecordStorage | null = browserStorage()): RunRecord | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return parseRecord(JSON.parse(raw));
  } catch {
    // 사람이 고쳐 놨거나 옛 형식이다. 없는 셈 치면 다음 판이 그 자리를 덮는다.
    return null;
  }
}

/**
 * 방금 끝난 판을 기록에 제출한다. 결과 화면은 이 함수의 반환값만 보고 그린다.
 *
 * 저장에 실패해도 예외를 밖으로 내보내지 않는다 — 부르는 쪽은 쓰러진 화면을 그리는
 * 중이고, 여기서 예외가 나면 그 화면이 뜨지 않아 판에서 빠져나갈 길이 없어진다.
 */
export function submitRun(
  run: RunResult,
  storage: RecordStorage | null = browserStorage(),
): RecordOutcome {
  const ranked = run.revives === 0;
  const previous = readBest(storage);
  const current: RunRecord = { level: run.level, kills: run.kills, time: run.time };

  if (!ranked) return { best: previous, previous, isNew: false, ranked, saved: false };
  if (previous && !isBetter(current, previous)) {
    return { best: previous, previous, isNew: false, ranked, saved: false };
  }

  return { best: current, previous, isNew: true, ranked, saved: write(storage, current) };
}

/** 저장에 성공했으면 true. 프라이빗 모드·용량 초과는 조용히 false. */
function write(storage: RecordStorage | null, record: RunRecord): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** 읽은 값이 세 숫자를 제대로 갖췄는지 확인한다. 하나라도 어긋나면 null. */
function parseRecord(value: unknown): RunRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const level = raw['level'];
  const kills = raw['kills'];
  const time = raw['time'];
  if (!isCount(level) || !isCount(kills) || !isCount(time)) return null;
  return { level, kills, time };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
