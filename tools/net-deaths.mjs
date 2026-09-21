/**
 * 죽은 바퀴 세기: 루프 로그에서 바퀴가 어떤 까닭으로 죽었는지 날짜별로 센다.
 *
 *   npm run deaths
 *
 * STATUS.md '사용자에게 묻고 싶은 것'의 **망 항목**(세션 109)과 **전원 항목**(세션 108)이
 * 묻는 수가 바로 이 수다. 두 고장은 섞으면 안 된다 — 전원은 닫혔고 망은 열려 있다.
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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 에러 줄 뒤 이 줄 수 안에 종료 줄이 와야 '그 바퀴를 죽인 것'으로 본다. */
const WINDOW = 3;

/** 무엇으로 죽었는가 — 로그 한 줄로 가른다(STATUS 망 항목의 구별법 그대로). */
const CAUSES = [
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
];

const ENDED_BAD = /바퀴 #\d+ 종료 \(exit=[1-9]/;

function countFile(text) {
  const lines = text.split('\n');
  const counts = Object.fromEntries(CAUSES.map((c) => [c.key, 0]));

  for (let i = 0; i < lines.length; i++) {
    const cause = CAUSES.find((c) => c.test(lines[i]));
    if (!cause) continue;
    // 바로 뒤에 exit≠0 종료가 따라오는 것만 진짜 고장이다(위 '어떻게 세는가').
    const closed = lines
      .slice(i + 1, i + 1 + WINDOW + 1)
      .some((l) => ENDED_BAD.test(l));
    if (closed) counts[cause.key]++;
  }
  return counts;
}

const dir = join(process.cwd(), 'logs');
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
  .sort();

const totals = Object.fromEntries(CAUSES.map((c) => [c.key, 0]));
const rows = [];

for (const f of files) {
  const counts = countFile(readFileSync(join(dir, f), 'utf8'));
  for (const c of CAUSES) totals[c.key] += counts[c.key];
  if (CAUSES.some((c) => counts[c.key] > 0)) rows.push([f.slice(0, -4), counts]);
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const num = (n) => String(n).padStart(4, ' ');

console.log(`\n죽은 바퀴 (logs/ ${files.length}일치)\n`);
console.log(`  ${pad('날짜', 12)}${CAUSES.map((c) => num(c.key)).join('  ')}`);
for (const [day, counts] of rows) {
  console.log(`  ${pad(day, 12)}${CAUSES.map((c) => num(counts[c.key])).join('  ')}`);
}
console.log(`  ${pad('─'.repeat(10), 12)}${CAUSES.map(() => num('──')).join('  ')}`);
console.log(`  ${pad('합', 12)}${CAUSES.map((c) => num(totals[c.key])).join('  ')}\n`);
for (const c of CAUSES) console.log(`  ${c.key} = ${c.label}: ${totals[c.key]}개`);
console.log('');
