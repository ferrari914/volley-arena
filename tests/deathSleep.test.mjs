import { describe, expect, it } from 'vitest';
import {
  ASLEEP_SHARE,
  WAKE_GRACE_SECONDS,
  classifyDeath,
  describeVerdict,
  lastWakeBefore,
  parseSleepSpans,
  sleptDuring,
} from '../tools/lib/sleepSpans.mjs';
import { KNOWN_OTHER, OTHER, collectDeaths, splitOther } from '../tools/lib/deathLog.mjs';

/**
 * **죽은 바퀴를 낱말이 아니라 시각으로 되짚는 자**(`npm run deaths`의 둘째 표).
 *
 * 왜 검사가 필요한가: 이 자가 내는 값은 **사람이 눈으로 확인할 수 없다.** 이틀 전 밤에
 * 이 맥이 자고 있었는지를 기억하는 사람은 없고, 그래서 자가 틀린 값을 내도 그대로 믿는다.
 * 세션 113이 처음 돌린 자가 정확히 그렇게 틀렸다 — 147시간을 잔 기계를 "0% 잤다"고 했고,
 * 그 값만 보면 "역시 망 문제였다"는 **정반대 결론**이 나온다. 아래 첫 묶음이 그 함정이다.
 */

/** `pmset -g log`에서 실제로 긁어 온 모양 그대로다(2026-09-22 · 세션 113). */
const PMSET = [
  '2026-09-22 12:43:17 +0900 Sleep           \tEntering Sleep state due to \'Clamshell Sleep\':TCPKeepAlive=active',
  '2026-09-22 12:43:19 +0900 Wake Requests   \t[*process=dasd request=SleepService deltaSecs=1060 wakeAt=2026-09-22 13:00:59',
  '2026-09-22 12:43:19 +0900 PM Client Acks  \tDelays to Sleep notifications: [com.apple.bluetooth.sleep is slow(1554 ms)]',
  '2026-09-22 12:44:09 +0900 DarkWake        \tDarkWake from Deep Idle [CDNP] : due to smc.70070000 wifibt',
  '2026-09-22 12:44:37 +0900 Sleep           \tEntering Sleep state due to \'Maintenance Sleep\':TCPKeepAlive=active',
  '2026-09-22 12:44:39 +0900 Wake Requests   \t[*process=dasd request=SleepService deltaSecs=947 wakeAt=2026-09-22 13:00:26',
  '2026-09-22 13:00:26 +0900 DarkWake        \tDarkWake from Deep Idle [CDNP] : due to NUB.SPMI0.SW3',
].join('\n');

const at = (text) => Date.parse(text.replace(' ', 'T') + '+09:00');

describe('잠든 구간을 pmset에서 읽는다', () => {
  it('`Wake Requests`를 깨어난 것으로 세지 않는다 (세션 113이 빠진 함정)', () => {
    // 이 줄은 깨어난 기록이 아니라 "다음에 언제 깨울지 적어 둔 쪽지"다. 잠든 지 2초 뒤에 온다.
    // 헐거운 자로 읽으면 잠이 2초 만에 닫혀, 17분을 잔 기계가 "거의 안 잤다"가 된다.
    const { spans } = parseSleepSpans(PMSET);
    expect(spans).toHaveLength(2);
    expect(spans[0][1] - spans[0][0]).toBe(52_000); // 12:43:17 → 12:44:09
    expect(spans[1][1] - spans[1][0]).toBe(949_000); // 12:44:37 → 13:00:26
  });

  it('기록이 언제부터 있는지를 함께 돌려준다', () => {
    expect(parseSleepSpans(PMSET).since).toBe(at('2026-09-22 12:43:17'));
    expect(parseSleepSpans('').since).toBeNull();
  });

  it('잇따라 찍힌 Sleep은 잠을 다시 열지 않는다 (첫 시각을 지킨다)', () => {
    const doubled = [
      '2026-09-22 01:00:00 +0900 Sleep \tEntering Sleep state due to \'Maintenance Sleep\'',
      '2026-09-22 01:00:05 +0900 Sleep \tEntering Sleep state due to \'Sleep Service Back to Sleep\'',
      '2026-09-22 02:00:00 +0900 Wake  \tWake from Deep Idle [CDNVA] : due to smc.70070000 lid',
    ].join('\n');
    const { spans } = parseSleepSpans(doubled);
    expect(spans).toEqual([[at('2026-09-22 01:00:00'), at('2026-09-22 02:00:00')]]);
  });

  it('안 닫힌 마지막 잠은 지금까지 자고 있는 것으로 본다', () => {
    const open = '2026-09-22 01:00:00 +0900 Sleep \tEntering Sleep state due to \'Clamshell Sleep\'';
    const { spans } = parseSleepSpans(open, at('2026-09-22 03:00:00'));
    expect(spans[0][1] - spans[0][0]).toBe(2 * 3600_000);
  });

  it('겹친 시간만 센다 — 창 밖의 잠은 그 바퀴 것이 아니다', () => {
    const spans = [[at('2026-09-22 01:00:00'), at('2026-09-22 02:00:00')]];
    expect(sleptDuring(spans, at('2026-09-22 01:30:00'), at('2026-09-22 03:00:00'))).toBe(1800_000);
    expect(sleptDuring(spans, at('2026-09-22 02:00:00'), at('2026-09-22 03:00:00'))).toBe(0);
  });

  it('직전에 깨어난 시각은 창이 열리기 전의 것만 본다', () => {
    const spans = [
      [at('2026-09-22 01:00:00'), at('2026-09-22 02:00:00')],
      [at('2026-09-22 05:00:00'), at('2026-09-22 06:00:00')],
    ];
    expect(lastWakeBefore(spans, at('2026-09-22 03:00:00'))).toBe(at('2026-09-22 02:00:00'));
    expect(lastWakeBefore(spans, at('2026-09-22 00:30:00'))).toBeNull();
  });
});

describe('죽은 바퀴 하나를 무엇이라 부르는가 (손으로 박은 값)', () => {
  const spans = [[at('2026-09-22 01:00:00'), at('2026-09-22 02:00:00')]];
  const since = at('2026-09-22 00:00:00');
  const verdict = (from, to) =>
    classifyDeath({ from: at(from), to: at(to), spans, since }).kind;

  it('기록이 안 닿는 때는 "모른다"이지 "안 잤다"가 아니다', () => {
    // 없는 결백을 만들어 내면, 그 값을 근거로 엉뚱한 곳(망·서버)을 파게 된다.
    expect(verdict('2026-09-21 23:00:00', '2026-09-21 23:30:00')).toBe('unmeasured');
    expect(classifyDeath({ from: 1, to: 2, spans, since: null }).kind).toBe('unmeasured');
  });

  it('창의 절반 넘게 잤으면 문구가 무엇이든 잠이다', () => {
    expect(verdict('2026-09-22 01:30:00', '2026-09-22 02:00:00')).toBe('asleep'); // 100%
    expect(verdict('2026-09-22 01:30:00', '2026-09-22 02:25:00')).toBe('asleep'); // 55%
  });

  it('선을 정확히 절반에 두고, 그 아래는 잠이라 부르지 않는다', () => {
    expect(ASLEEP_SHARE).toBe(0.5);
    // 잠 30분 / 창 60분 = 0.5 — 딱 절반은 잠이 아니다(넘어야 한다).
    const half = classifyDeath({
      from: at('2026-09-22 01:30:00'),
      to: at('2026-09-22 02:30:00'),
      spans,
      since,
    });
    expect(half.share).toBe(0.5);
    expect(half.kind).not.toBe('asleep');
  });

  it('깬 지 15분 안에 죽은 것은 잠의 꼬리로 따로 센다', () => {
    // 깨어난 기계는 CPU가 돌아도 Wi-Fi 재접속과 DNS가 아직이다.
    expect(WAKE_GRACE_SECONDS).toBe(900);
    expect(verdict('2026-09-22 02:12:00', '2026-09-22 02:15:00')).toBe('just-woke');
  });

  it('깬 지 오래된 기계에서 죽은 것만이 진짜 망이다', () => {
    expect(verdict('2026-09-22 02:16:00', '2026-09-22 02:19:00')).toBe('awake');
    // 기록이 넉넉히 앞서 시작했고 그 안에 잠이 없으면, 그것은 진짜로 안 잔 것이다.
    expect(
      classifyDeath({ from: at('2026-09-22 03:00:00'), to: at('2026-09-22 03:01:00'), spans: [], since }).kind,
    ).toBe('awake');
  });

  it('기록이 시작된 직후에 죽은 것은 "안 잤다"고 단정하지 않는다', () => {
    // pmset의 기록은 앞에서부터 지워진다. 직전에 깬 자국이 지워졌을 뿐인 것을
    // '깨어 있었다'로 적으면 없는 결백을 만들어 낸다 — 세션 113이 실제로 겪었다:
    // 같은 네 바퀴가 10분 사이에 `깬 지 0.3분`에서 `깨어 있었다`로 뒤집혔다(코드는 그대로).
    const justAfter = classifyDeath({
      from: since + 60_000,
      to: since + 120_000,
      spans: [],
      since,
    });
    expect(justAfter.kind).toBe('unmeasured');
  });

  it('기록 앞머리에서도, 잔 것을 봤으면 그것은 본 것이다', () => {
    // 모르는 쪽으로 미루는 것은 '안 잤다'는 단정뿐이다. 관측된 잠까지 버리면 아무것도 못 센다.
    const seen = classifyDeath({
      from: at('2026-09-22 01:00:00'),
      to: at('2026-09-22 01:30:00'),
      spans,
      since: at('2026-09-22 00:59:00'),
    });
    expect(seen.kind).toBe('asleep');
  });

  it('적는 말이 제 숫자와 같은 것을 가리킨다', () => {
    expect(describeVerdict({ kind: 'asleep', share: 0.987 })).toBe('잠 99%');
    expect(describeVerdict({ kind: 'just-woke', wokeSecondsAgo: 244 })).toBe('깬 지 4.1분');
    expect(describeVerdict({ kind: 'unmeasured' })).toContain('잴 수 없다');
  });
});

describe('로그에서 죽은 바퀴를 골라낸다', () => {
  const LOG = [
    '  바퀴 #359  시작: 2026-09-22 12:42:23',
    '  모델: claude-opus-5 / 최대 턴: 80',
    '════',
    'API Error: Can\'t reach the API server — check your internet or DNS (ENOTFOUND)',
    '',
    '  바퀴 #359 종료 (exit=1): 2026-09-22 16:00:26',
    '',
    '  바퀴 #360  시작: 2026-09-22 16:35:23',
    '  이번 바퀴는 ENOTFOUND가 무엇인지 STATUS에 적어 두었습니다.',
    '  바퀴 #360 종료 (exit=0): 2026-09-22 16:52:44',
  ].join('\n');

  it('죽은 바퀴의 창(시작~종료)을 함께 들고 나온다', () => {
    const [death, ...rest] = collectDeaths(LOG, '2026-09-22');
    expect(rest).toHaveLength(0);
    expect(death).toMatchObject({ cause: 'net', cycle: '359', day: '2026-09-22' });
    expect(death.from).toBe(Date.parse('2026-09-22T12:42:23'));
    expect(death.to).toBe(Date.parse('2026-09-22T16:00:26'));
  });

  it('세션이 보고문에 인용한 낱말은 세지 않는다 (grep이 틀리던 자리)', () => {
    // #360은 ENOTFOUND를 말만 했고 exit=0으로 멀쩡히 닫혔다. grep -c는 이것을 같이 센다.
    expect(collectDeaths(LOG, '2026-09-22').some((d) => d.cycle === '360')).toBe(false);
  });

  it('시작 줄이 없는 바퀴는 창 없이 센다 (표에서는 빠지지 않는다)', () => {
    const cut = LOG.split('\n').slice(2).join('\n');
    const [death] = collectDeaths(cut, '2026-09-22');
    expect(death.cause).toBe('net');
    expect(death.from).toBeNull();
  });
});

describe('낱말을 모르는 죽음도 표에 남는다 (세션 115가 박는다)', () => {
  /**
   * 왜 이 묶음이 있는가: 예전 자는 **아는 낱말 셋만** 셌다. 그래서 오늘 잇따라 죽은
   * `#451`·`#452`가 표에서 통째로 빠졌고, 표만 보면 "오늘 인증으로 죽은 바퀴는 없다"로 읽힌다.
   * 세지 못하는 것과 일어나지 않은 것을 가르는 자다.
   */
  const LOG = [
    '════════════════════════════════════════════════════════════',
    '  바퀴 #451  시작: 2026-09-24 15:51:33',
    '  모델: claude-opus-5 / 최대 턴: 80',
    '════════════════════════════════════════════════════════════',
    'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.',
    '',
    '  바퀴 #451 종료 (exit=1): 2026-09-24 16:37:08',
    '',
    '  바퀴 #119  시작: 2026-09-15 19:36:14',
    '  모델: claude-opus-5 / 최대 턴: 80',
    '════════════════════════════════════════════════════════════',
    'API Error: Connection dropped (ECONNRESET)',
    '',
    '  바퀴 #119 종료 (exit=1): 2026-09-15 21:37:16',
  ].join('\n');

  it('401은 제 칸을 얻는다 — 잠도 망도 아니고, 다시 로그인하기 전까지 여는 바퀴마다 똑같이 죽는다', () => {
    const [auth] = collectDeaths(LOG, '2026-09-24');
    expect(auth).toMatchObject({ cause: 'auth', cycle: '451' });
    expect(auth.hint).toBeNull(); // 이름이 있는 죽음은 줄을 따로 적지 않는다
  });

  it('아무 낱말도 안 맞으면 사라지지 않고 `other`로 남고, 그 줄을 들고 온다', () => {
    const unknown = collectDeaths(LOG, '2026-09-24').find((d) => d.cause === OTHER);
    expect(unknown.cycle).toBe('119');
    expect(unknown.hint).toBe('API Error: Connection dropped (ECONNRESET)');
  });

  it('까닭을 찾을 때 루프가 제 손으로 찍는 줄(머리말·구분선)은 건너뛴다', () => {
    // 이것을 안 건너뛰면 모든 `other`의 까닭이 `════…`나 `모델: …`이 되어 아무 말도 못 한다.
    const bare = [
      '════════════════════════════════════════════════════════════',
      '  바퀴 #7  시작: 2026-09-24 01:00:00',
      '  모델: claude-opus-5 / 최대 턴: 80',
      '════════════════════════════════════════════════════════════',
      'zsh: killed     claude -p',
      '',
      '  바퀴 #7 종료 (exit=137): 2026-09-24 01:02:00',
    ].join('\n');
    expect(collectDeaths(bare, '2026-09-24')[0].hint).toBe('zsh: killed     claude -p');
  });

  it('exit≠0으로 닫힌 바퀴의 수와 표의 줄 수가 같다 (표가 census다)', () => {
    // 이 한 줄이 이 묶음의 요점이다. 낱말을 몇 개 아는지와 무관하게 수가 맞아야 한다.
    const mixed = [LOG, '', '  바퀴 #500 종료 (exit=2): 2026-09-24 20:00:00'].join('\n');
    const bad = mixed.match(/바퀴 #\d+ 종료 \(exit=[1-9]\d*\)/g).length;
    expect(collectDeaths(mixed, '2026-09-24')).toHaveLength(bad);
  });

  it('멀쩡히 닫힌 바퀴는 여전히 세지 않는다 (인용문을 거르던 규칙을 깨지 않았다)', () => {
    const quoted = [
      '  바퀴 #360  시작: 2026-09-22 16:35:23',
      '  이번 바퀴는 401 OAuth access token has expired가 무엇인지 STATUS에 적어 두었습니다.',
      '  바퀴 #360 종료 (exit=0): 2026-09-22 16:52:44',
    ].join('\n');
    expect(collectDeaths(quoted, '2026-09-22')).toHaveLength(0);
  });
});

describe('끝난 일이 계속 세어지지 않게 한다 (세션 116이 박는다)', () => {
  /**
   * 왜 이 묶음이 있는가: 세션 115가 `other` 칸을 만들면서 "0이 아니면 새 고장"이라는 읽는 법을
   * 함께 남겼는데, **읽어서 이름을 적어도 로그의 그 줄은 지워지지 않는다.** 그래서 그 경보는
   * 다음 바퀴부터 영원히 거짓으로 울리고, 세션 116은 그 울림 하나를 되짚는 데 바퀴 몫을 썼다.
   * 여기서 지키는 것은 **"수"가 아니라 "새로 생긴 것이 있는가"가 판정이라는 것**이다.
   */
  const dead = (cycle, day, line) =>
    [
      `  바퀴 #${cycle}  시작: ${day} 01:00:00`,
      '  모델: claude-opus-5 / 최대 턴: 80',
      line,
      '',
      `  바퀴 #${cycle} 종료 (exit=1): ${day} 02:00:00`,
    ].join('\n');

  const 이미읽음 = KNOWN_OTHER[0];

  it('이미 읽어 둔 죽음은 `known`으로 가고, 그때 `fresh`는 비어 있다', () => {
    const deaths = collectDeaths(
      dead(이미읽음.cycle, 이미읽음.day, 'API Error: Connection lost mid-response.'),
      이미읽음.day,
    );
    const { fresh, known } = splitOther(deaths);
    expect(known.map((d) => d.cycle)).toEqual([이미읽음.cycle]);
    expect(fresh).toEqual([]); // 이 한 줄이 이 묶음의 요점이다
  });

  it('이름 없는 죽음이 하나라도 새로 생기면 `fresh`가 그것만 들고 온다', () => {
    const log = [
      dead(이미읽음.cycle, 이미읽음.day, 'API Error: Connection lost mid-response.'),
      dead('777', 이미읽음.day, 'zsh: killed     claude -p'),
    ].join('\n\n');
    const { fresh, known } = splitOther(collectDeaths(log, 이미읽음.day));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ cycle: '777', hint: 'zsh: killed     claude -p' });
    expect(known).toHaveLength(1); // 새것이 떠도 이미 읽은 것을 새것으로 세지 않는다
  });

  it('바퀴 번호가 같아도 날짜가 다르면 아직 안 읽은 것이다 (번호는 날마다 돌지 않지만 로그는 갈린다)', () => {
    const 딴날 = '2026-01-01';
    const { fresh } = splitOther(
      collectDeaths(dead(이미읽음.cycle, 딴날, 'API Error: 뭔지 모를 줄'), 딴날),
    );
    expect(fresh).toHaveLength(1);
  });

  it('이름이 있는 죽음은 아무리 많아도 이 셈에 들어오지 않는다', () => {
    const named = [
      dead('1', '2026-09-24', 'API Error: ... (ENOTFOUND)'),
      dead('2', '2026-09-24', 'Your computer went to sleep mid-response'),
      dead('3', '2026-09-24', 'API Error: 401 OAuth access token has expired.'),
    ].join('\n\n');
    const { fresh, known } = splitOther(collectDeaths(named, '2026-09-24'));
    expect([...fresh, ...known]).toEqual([]);
  });

  it('로그에 없는 기준선 줄은 `stale`로 뜬다 — 기준선이 조용히 썩지 않게 하는 자다', () => {
    const { stale } = splitOther([]); // 죽은 바퀴가 하나도 없는 로그
    expect(stale).toEqual(KNOWN_OTHER);
  });

  it('기준선의 모든 줄이 무엇이었는지와 누가 읽었는지를 적고 있다', () => {
    // 이름만 적고 까닭을 안 적으면 다음 바퀴가 또 로그를 뒤진다. 기준선의 값어치는 note에 있다.
    for (const k of KNOWN_OTHER) {
      expect(k.cycle).toMatch(/^\d+$/);
      expect(k.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(k.note).toMatch(/세션 \d+/);
    }
  });
});
