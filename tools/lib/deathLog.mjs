/**
 * **루프 로그에서 "죽은 바퀴"만 골라낸다.** 세는 일과 적는 일은 `tools/net-deaths.mjs`가 한다.
 *
 * ── 왜 스크립트로 만들었나 (grep 하지 마라)
 * STATUS.md와 로그는 이 수를 `grep -c ENOTFOUND logs/*.log`로 세라고 적어 두었는데,
 * **그 명령은 자기가 적은 글자를 같이 센다.** 세션들이 STATUS와 보고문에 이 고장을
 * 설명하면서 `ENOTFOUND`라는 낱말과 에러 줄 자체를 인용해 두었기 때문이다.
 * 실제로 2026-09-21에 `grep -c`는 **19**를, 줄 머리만 보는 `grep -c '^API Error'`조차
 * **6**을 내지만(코드블록 안의 인용이 줄 머리에 온다), 진짜로 죽은 바퀴는 **5**다.
 *
 * 이 잘못된 셈에 이미 세 바퀴가 걸렸다(#295는 8을 보고 손으로 걸러 냈고, #300은 19를
 * 보고 네 번을 더 뒤져 5임을 확인했다). PROMPT ③·⑥이 말하는 "두 번 나온 지적은
 * 기계가 재게 하라"가 정확히 이 경우라 여기 박아 둔다.
 *
 * ── 어떻게 세는가
 * 인용문과 진짜 고장을 가르는 것은 낱말이 아니라 **자리**다. 진짜로 죽은 바퀴는
 * 에러 줄 바로 뒤에 루프가 찍는 `바퀴 #N 종료 (exit=1)`이 따라온다. 세션이 보고문
 * 안에서 인용한 줄에는 그것이 따라오지 않는다. 그래서 에러 줄에서 몇 줄 안에
 * exit≠0 종료가 오는 것만 센다.
 *
 * 이 방식은 세션 109가 손으로 센 표(9/10일 2 · 9/14일 4 · 9/15일 20 · 9/16일 4 ·
 * 9/17일 2 · 9/21일 5 = 37)를 그대로 재현한다. 값이 그 표와 어긋나면 셈이 아니라
 * 로그 형식이 바뀐 것이니 여기부터 고쳐라.
 */

/** 에러 줄 뒤 이 줄 수 안에 종료 줄이 와야 '그 바퀴를 죽인 것'으로 본다. */
export const WINDOW = 3;

/** 낱말로 가를 수 없는 죽음이 들어가는 칸. 이 칸이 있어야 표가 census가 된다(위 '빠짐 없이'). */
export const OTHER = 'other';

/** 무엇으로 죽었는가 — 로그 한 줄로 가른다(STATUS 망 항목의 구별법 그대로). */
export const CAUSES = [
  { key: 'net', label: '망(ENOTFOUND)', test: (l) => l.includes('ENOTFOUND') },
  {
    key: 'sleep',
    label: '잠(went to sleep)',
    test: (l) => l.includes('went to sleep mid-response'),
  },
  {
    key: 'turns',
    label: '턴 소진(max turns)',
    test: (l) => l.includes('Reached max turns'),
  },
  {
    // 세션 115가 붙인다. 이것만은 잠도 망도 아니다 — 기계가 깨어 있고 망이 멀쩡해도 죽고,
    // **사용자가 다시 로그인하기 전까지는 여는 바퀴마다 똑같이 죽는다.**
    key: 'auth',
    label: '인증 만료(401)',
    test: (l) => l.includes('Failed to authenticate') || l.includes('OAuth access token has expired'),
  },
  {
    // 낱말이 없는 칸이다. `test`가 없으므로 아래 collectDeaths가 "아무 것도 안 맞은 죽음"을
    // 여기로 몰아넣는다. **이 칸의 수를 새 고장의 수로 읽지 마라**(세션 116이 고친다):
    // 한 번 읽어서 이름을 적어 둔 죽음도 로그에 그대로 남아 계속 세어진다. 새로 생긴 것만
    // 가려내는 것은 아래 `KNOWN_OTHER`와 `splitOther`이고, 그때 읽을 것은 `hint`에 찍힌 줄이다.
    key: OTHER,
    label: '까닭 모름(그 밖의 exit≠0)',
    test: null,
  },
];

/**
 * **이미 읽고 이름을 적어 둔 `other` 죽음.** 새로 생긴 것과 가르는 기준선이다.
 *
 * ── 왜 필요한가 (세션 116이 값을 치르고 적는다)
 * 세션 115가 `other` 칸을 만들면서 "이 칸이 0이 아니면 새 고장이 하나 생긴 것"이라는 읽는 법을
 * STATUS와 이 파일에 함께 박아 두었다. **그 읽는 법은 한 바퀴밖에 맞지 않는다** — 읽고 나서
 * 이름을 적어도 로그의 그 줄은 지워지지 않으므로 칸은 영원히 2에 머물고, 경보는 **매 바퀴
 * 똑같이 울린다.** 세션 116은 그 울림을 보고 STATUS를 거꾸로 뒤져 "둘 다 세션 115가 이미
 * 읽은 것"임을 확인하는 데 이 바퀴의 몫을 썼다. 사람이 기억으로 가르던 것을 여기 넘긴다.
 *
 * 세션 110의 `grep`·세션 114의 `9 passed (9)`와 뿌리가 같다 — **다른 것을 같은 수로 세는 것.**
 * 거기서는 안 일어난 일이 세어졌고, 여기서는 **끝난 일이 계속 세어진다.**
 *
 * ── 새 줄을 더하는 법
 * `npm run deaths`가 이름 없는 죽음을 찍으면, 그 줄을 읽고 까닭을 STATUS에 적은 **뒤에**
 * 여기 한 줄을 더해라. `note`에는 무엇이었는지와 **누가 읽었는지**를 적는다.
 * 반대로 여기 있는 줄이 로그에서 사라지면(로그가 지워지면) `npm run deaths`가 그것도 알려 준다 —
 * 기준선이 조용히 썩지 않게 하는 자다.
 */
export const KNOWN_OTHER = [
  {
    cycle: '15',
    day: '2026-09-09',
    note: 'Connection lost mid-response — 세션 115가 읽었다(망 계열이지만 ENOTFOUND 낱말이 없다)',
  },
  {
    cycle: '119',
    day: '2026-09-15',
    note: 'Connection dropped (ECONNRESET) — 세션 115가 읽었다(같은 계열이다)',
  },
];

/**
 * `other` 죽음을 **이미 읽은 것 · 새로 생긴 것 · 썩은 기준선** 셋으로 가른다.
 *
 * `fresh`가 비어 있지 않을 때만 이 저장소가 아직 이름 붙이지 못한 고장이 있는 것이다.
 * `stale`은 `KNOWN_OTHER`에 적혀 있는데 지금 로그에 없는 줄이다 — 하루치 로그만 넣으면
 * 당연히 다 여기로 오므로, **전체 census를 넣을 때만 뜻이 있다**(`tools/net-deaths.mjs`).
 *
 * @param {ReturnType<typeof collectDeaths>} deaths
 */
export function splitOther(deaths) {
  const others = deaths.filter((d) => d.cause === OTHER);
  const same = (k, d) => k.cycle === d.cycle && k.day === d.day;
  const isKnown = (d) => KNOWN_OTHER.some((k) => same(k, d));
  return {
    fresh: others.filter((d) => !isKnown(d)),
    known: others.filter(isKnown),
    stale: KNOWN_OTHER.filter((k) => !others.some((d) => same(k, d))),
  };
}

const STARTED = /바퀴 #(\d+)\s+시작: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
const ENDED_BAD = /바퀴 #(\d+) 종료 \(exit=[1-9]\d*\): (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

/** 로그의 시각은 이 기계의 지역 시간으로 찍힌다(오프셋이 없다). 그대로 지역 시간으로 읽는다. */
const stamp = (text) => Date.parse(text.replace(' ', 'T'));

/** 루프가 제 손으로 찍는 줄. 까닭을 찾을 때 이 줄들은 건너뛴다(내용이 없다). */
const DECOR = /^[\s═]*$|^\s*바퀴 #\d+|^\s*모델:/;

/** 죽은 줄 앞에서 뜻이 있는 마지막 줄 하나. 까닭을 모르는 죽음은 이 줄이 전부다. */
function lastMeaningful(lines, end) {
  for (let i = end - 1; i >= 0 && i >= end - 12; i--) {
    if (!DECOR.test(lines[i]) && lines[i].trim() !== '') return lines[i].trim().slice(0, 100);
  }
  return null;
}

/**
 * 죽은 바퀴를 순서대로 돌려준다.
 *
 * **시작 시각도 함께 들고 나오는 까닭**: 죽은 까닭을 낱말이 아니라 시각으로 되짚으려면
 * 바퀴가 열려 있던 창이 필요하다(`tools/lib/sleepSpans.mjs`). 종료 줄만으로는
 * "그때 이 기계가 자고 있었나"를 물을 수 없다.
 *
 * **빠짐 없이 세는 까닭**(세션 115): 예전에는 위 CAUSES의 낱말이 하나도 안 맞으면 그 바퀴가
 * 표에서 **통째로 사라졌다.** 그래서 오늘 잇따라 죽은 `#451`·`#452`가 표에 없었고, 표만 보면
 * "오늘은 잠으로만 죽었다"로 읽힌다. 실제로 사라져 있던 것이 다섯이다(9/09 `Connection lost` ·
 * 9/15 `401`과 `ECONNRESET` · 9/24 `401` 둘). **exit≠0으로 닫힌 바퀴는 무조건 한 줄이 되고**,
 * 낱말이 안 맞으면 `other` 칸에 로그의 그 줄(`hint`)과 함께 들어간다.
 * (세션 110의 grep · 세션 114의 `9 passed (9)`와 같은 병이다 — 표에 안 뜨면 없는 것으로 읽힌다.)
 *
 * @param {string} text 하루치 로그
 * @param {string} day 파일 이름의 날짜(YYYY-MM-DD)
 * @returns {Array<{day:string, cause:string, cycle:string, from:number|null, to:number, hint:string|null}>}
 */
export function collectDeaths(text, day) {
  const lines = text.split('\n');
  const opened = new Map();
  const deaths = [];
  let pending = null;

  for (let i = 0; i < lines.length; i++) {
    const start = STARTED.exec(lines[i]);
    if (start) opened.set(start[1], stamp(start[2]));

    const cause = CAUSES.find((c) => c.test && c.test(lines[i]));
    if (cause) {
      pending = { cause: cause.key, until: i + WINDOW + 1 };
      continue;
    }

    const end = ENDED_BAD.exec(lines[i]);
    if (!end) continue;
    // 낱말이 바로 앞에 있으면 그것이 까닭이고(위 '어떻게 세는가'), 없으면 까닭을 모르는 것이지
    // 죽지 않은 것이 아니다. 인용문을 걸러 내는 일은 여기서 필요 없다 — exit≠0 종료 줄은
    // 루프가 직접 찍는 줄이라 세션이 흉내 낼 수 없다.
    const named = pending && i <= pending.until ? pending.cause : OTHER;
    deaths.push({
      day,
      cause: named,
      cycle: end[1],
      from: opened.get(end[1]) ?? null,
      to: stamp(end[2]),
      hint: named === OTHER ? lastMeaningful(lines, i) : null,
    });
    pending = null;
  }
  return deaths;
}
