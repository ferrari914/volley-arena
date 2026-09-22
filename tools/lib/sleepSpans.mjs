/**
 * **죽은 바퀴가 죽을 때 이 기계가 자고 있었는지를 가른다.**
 *
 * ── 왜 필요한가 (세션 113이 겪은 것)
 * `npm run deaths`의 표에는 칸이 셋 있고, 그중 둘(`net` · `sleep`)은 **로그에 찍힌 문구로만**
 * 갈린다: `ENOTFOUND`면 망, `went to sleep mid-response`면 잠. 그런데 **잠든 기계는
 * 망 문구로도 죽는다** — 자는 동안 Wi-Fi가 내려가 있으니 DNS가 안 풀리고, 클로드는
 * 그것을 "API 서버에 못 닿는다"로 적는다. 곧 `net` 칸에는 두 고장이 섞여 있다.
 *
 * 세션 109가 그 칸의 37개를 보고 "망 문제"라는 물음을 열었고 네 바퀴가 그 물음을 이어 적었다.
 * 실제로 재 보니 **잴 수 있는 15개 중 깨어 있던 기계에서 죽은 것은 0개다**(잠 9 · 깬 직후 6).
 * 문구는 두 가지였지만 까닭은 하나였다.
 *
 * ── 그래서 낱말 대신 시각을 본다
 * 로그가 적어 둔 바퀴의 창(시작~종료)을 `pmset -g log`의 잠든 구간과 겹쳐 본다.
 * 낱말은 거짓을 말할 수 있지만 두 시계는 못 그런다.
 *
 * ── 여기 박아 둔 함정 하나 (검사로 고정해 두었다)
 * `pmset -g log`에는 잠든 지 2~3초 뒤에 **`Wake Requests`**라는 줄이 따라온다.
 * 이것은 깨어난 것이 아니라 "다음에 언제 깨울지 적어 둔 쪽지"다. 그런데
 * `/(Sleep|Wake|DarkWake)\s/` 같은 헐거운 자로 읽으면 이 줄이 잠을 3초 만에 닫아 버려
 * **147시간을 잔 기계가 "0% 잤다"고 나온다.** 세션 113이 처음 돌린 자가 정확히 그랬고,
 * 그 값을 믿었으면 "역시 망 문제"라고 적고 지나갈 뻔했다. 그래서 뒤따르는 말까지 본다.
 */

/** 잠든 구간이 바퀴의 창에서 이 몫을 넘으면 '잠'으로 본다. */
export const ASLEEP_SHARE = 0.5;

/**
 * 깬 지 이만큼(초) 안에 죽은 것은 '깬 직후'로 따로 센다.
 * **왜 따로 세나**: 깨어난 기계는 CPU가 돌아도 Wi-Fi 재접속과 DNS가 아직이라 망이 없다.
 * 이 창 안의 실패는 망이 나쁜 것이 아니라 **잠의 꼬리**다. 실제로 잰 여섯 개가
 * 전부 깬 지 0.1~12.2분에 죽었고, 그 너머에서 죽은 것은 하나도 없다(세션 113).
 */
export const WAKE_GRACE_SECONDS = 15 * 60;

/** `pmset -g log` 한 줄에서 잠/깸만 골라낸다. 뒤따르는 말까지 봐야 한다(머리말의 함정). */
const EVENT =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})\s+(Sleep|Wake|DarkWake)\s+(Entering Sleep state|Wake from|DarkWake from)/;

const stamp = (day, time, offset) =>
  Date.parse(`${day}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`);

/**
 * `pmset -g log`을 읽어 잠든 구간과, 이 기록이 언제부터 있는지를 돌려준다.
 *
 * **기록이 없는 때는 "안 잤다"가 아니라 "모른다"다.** pmset은 며칠치만 갖고 있어서
 * 그보다 오래된 바퀴는 잴 수 없다 — 그것을 0%로 적으면 없는 결백을 만들어 내는 것이다.
 *
 * @param {string} text `pmset -g log`의 출력
 * @param {number} now 마지막 잠이 안 닫혔을 때 쓸 끝 시각(ms)
 * @returns {{spans: Array<[number, number]>, since: number|null}}
 */
export function parseSleepSpans(text, now = Date.now()) {
  const spans = [];
  let since = null;
  let asleepAt = null;

  for (const line of text.split('\n')) {
    const m = EVENT.exec(line);
    if (!m) continue;
    const at = stamp(m[1], m[2], m[3]);
    if (Number.isNaN(at)) continue;
    if (since === null) since = at;

    if (m[4] === 'Sleep') {
      // 잠은 겹쳐 찍힐 수 있다(Maintenance Sleep이 잇따라 온다). 첫 시각을 지킨다.
      if (asleepAt === null) asleepAt = at;
    } else if (asleepAt !== null) {
      spans.push([asleepAt, at]);
      asleepAt = null;
    }
  }
  if (asleepAt !== null) spans.push([asleepAt, now]);
  return { spans, since };
}

/** 창(from~to)과 잠든 구간이 겹친 시간(ms). */
export function sleptDuring(spans, from, to) {
  let total = 0;
  for (const [start, end] of spans) {
    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/** `at` 이전에 이 기계가 마지막으로 깨어난 시각(ms). 모르면 null. */
export function lastWakeBefore(spans, at) {
  let woke = null;
  for (const [, end] of spans) if (end <= at) woke = end;
  return woke;
}

/**
 * 죽은 바퀴 하나를 넷 중 하나로 가른다.
 *
 * - `unmeasured` — pmset 기록이 그때까지 안 닿는다. **모른다고 적는다.**
 * - `asleep` — 창의 절반 넘게 잤다. 문구가 무엇이든 이건 잠이다.
 * - `just-woke` — 깨어 있었지만 깬 지 15분 안이다. 잠의 꼬리다.
 * - `awake` — 멀쩡히 깨어 있는 기계에서 죽었다. **이것만이 진짜 망이다.**
 *
 * @param {{from:number, to:number, spans:Array<[number,number]>, since:number|null}} death
 */
export function classifyDeath({ from, to, spans, since }) {
  if (since === null || from < since) {
    return { kind: 'unmeasured', share: null, slept: 0, wokeSecondsAgo: null };
  }
  const slept = sleptDuring(spans, from, to);
  const span = Math.max(1, to - from);
  const share = slept / span;
  if (share > ASLEEP_SHARE) return { kind: 'asleep', share, slept, wokeSecondsAgo: null };

  const woke = lastWakeBefore(spans, from);
  const wokeSecondsAgo = woke === null ? null : (from - woke) / 1000;
  if (wokeSecondsAgo !== null && wokeSecondsAgo <= WAKE_GRACE_SECONDS) {
    return { kind: 'just-woke', share, slept, wokeSecondsAgo };
  }
  return { kind: 'awake', share, slept, wokeSecondsAgo };
}

/** 가른 결과를 한 줄로 적는다. */
export function describeVerdict(verdict) {
  switch (verdict.kind) {
    case 'unmeasured':
      return '잴 수 없다(pmset 기록 밖)';
    case 'asleep':
      return `잠 ${(verdict.share * 100).toFixed(0)}%`;
    case 'just-woke':
      return `깬 지 ${(verdict.wokeSecondsAgo / 60).toFixed(1)}분`;
    default:
      return verdict.wokeSecondsAgo === null
        ? '깨어 있었다'
        : `깨어 있었다(깬 지 ${(verdict.wokeSecondsAgo / 60).toFixed(0)}분)`;
  }
}
