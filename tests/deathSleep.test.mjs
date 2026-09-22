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
import { collectDeaths } from '../tools/lib/deathLog.mjs';

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
