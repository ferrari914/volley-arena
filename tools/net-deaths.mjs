/**
 * 죽은 바퀴 세기: 루프 로그에서 바퀴가 어떤 까닭으로 죽었는지 날짜별로 센다.
 *
 *   npm run deaths
 *
 * STATUS.md '사용자에게 묻고 싶은 것'의 **망 항목**(세션 109)과 **덮개 항목**(세션 112)이
 * 묻는 수가 바로 이 수다.
 *
 * ── 표를 읽는 법 (세션 113이 붙인다 · 이것을 먼저 읽어라)
 * 위 표의 세 칸은 **로그에 찍힌 문구로만** 갈린다. 그런데 잠든 기계는 망 문구로도 죽으므로
 * (자는 동안 Wi-Fi가 내려가 DNS가 안 풀린다) **`net` 칸을 그대로 "망 문제"로 읽으면 틀린다.**
 * 그래서 아래에 둘째 표를 붙였다 — 죽은 시각을 `pmset -g log`의 잠든 구간과 겹쳐서
 * **낱말이 아니라 시각으로** 되짚는다. 까닭은 `tools/lib/sleepSpans.mjs` 머리말에 있다.
 *
 * 세는 법 자체(인용문과 진짜 고장을 가르는 법)는 `tools/lib/deathLog.mjs`에 있다.
 *
 * ── 표에 빠지는 죽음은 없다 (세션 115)
 * `exit≠0`으로 닫힌 바퀴는 낱말이 안 맞아도 `other` 칸에 들어가고, 그때는 로그의 그 줄까지
 * 함께 찍는다. 예전 표는 아는 낱말 셋만 셌기 때문에 **다섯을 통째로 빠뜨리고 있었다.**
 */

import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CAUSES, OTHER, collectDeaths } from './lib/deathLog.mjs';
import { classifyDeath, describeVerdict, parseSleepSpans } from './lib/sleepSpans.mjs';

const dir = join(process.cwd(), 'logs');
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
  .sort();

const deaths = files.flatMap((f) =>
  collectDeaths(readFileSync(join(dir, f), 'utf8'), f.slice(0, -4)),
);

const totals = Object.fromEntries(CAUSES.map((c) => [c.key, 0]));
const byDay = new Map();
for (const d of deaths) {
  totals[d.cause] += 1;
  if (!byDay.has(d.day)) byDay.set(d.day, Object.fromEntries(CAUSES.map((c) => [c.key, 0])));
  byDay.get(d.day)[d.cause] += 1;
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const num = (n) => String(n).padStart(4, ' ');

console.log(`\n죽은 바퀴 (logs/ ${files.length}일치)\n`);
console.log(`  ${pad('날짜', 12)}${CAUSES.map((c) => num(c.key)).join('  ')}`);
for (const [day, counts] of byDay) {
  console.log(`  ${pad(day, 12)}${CAUSES.map((c) => num(counts[c.key])).join('  ')}`);
}
console.log(`  ${pad('─'.repeat(10), 12)}${CAUSES.map(() => num('──')).join('  ')}`);
console.log(`  ${pad('합', 12)}${CAUSES.map((c) => num(totals[c.key])).join('  ')}\n`);
for (const c of CAUSES) console.log(`  ${c.key} = ${c.label}: ${totals[c.key]}개`);

// 낱말이 하나도 안 맞은 죽음. 여기 한 줄이라도 뜨면 **이 저장소가 아직 이름 붙이지 못한
// 고장**이니, 로그를 뒤지지 말고 이 줄부터 읽어라(`tools/lib/deathLog.mjs`의 '빠짐 없이').
const unknown = deaths.filter((d) => d.cause === OTHER);
if (unknown.length > 0) {
  console.log(`\n  까닭을 모르는 ${unknown.length}개 — 죽기 직전 로그에 찍힌 줄을 그대로 적는다:`);
  for (const d of unknown) {
    console.log(`    ${pad('#' + d.cycle, 7)}${pad(d.day, 12)}${d.hint ?? '(아무 줄도 없이 닫혔다)'}`);
  }
}

// ── 둘째 표: 그때 이 기계가 자고 있었나
let log = null;
try {
  log = execFileSync('pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 64 << 20 });
} catch {
  // 맥이 아니거나 pmset이 막혔다. 첫 표만 내고 끝낸다 — 없는 값을 지어내지 않는다.
}

if (log === null) {
  console.log('\n  (이 기계에서는 pmset을 읽을 수 없어 잠 대조는 건너뛴다)\n');
} else {
  const { spans, since } = parseSleepSpans(log);
  const dated = deaths.filter((d) => d.from !== null);
  const verdicts = dated.map((d) => ({ d, v: classifyDeath({ ...d, spans, since }) }));
  const measured = verdicts.filter(({ v }) => v.kind !== 'unmeasured');

  const from = since === null ? '기록 없음' : new Date(since).toLocaleString('sv').slice(0, 16);
  console.log(`\n그때 이 기계가 자고 있었나 (pmset -g log · ${from}부터 · ${spans.length}번 잤다)\n`);

  for (const { d, v } of measured) {
    const minutes = ((d.to - d.from) / 60000).toFixed(0);
    console.log(
      `  ${pad('#' + d.cycle, 7)}${pad(d.day + ' ' + new Date(d.from).toLocaleString('sv').slice(11, 16), 18)}` +
        `${String(minutes).padStart(4)}분  ${pad(d.cause, 6)}→ ${describeVerdict(v)}`,
    );
  }

  const tally = (kind, cause) =>
    measured.filter(({ d, v }) => v.kind === kind && (!cause || d.cause === cause)).length;
  const unmeasured = verdicts.length - measured.length;
  console.log(
    `\n  잰 것 ${measured.length}개: 잠 ${tally('asleep')} · 깬 직후 ${tally('just-woke')} · ` +
      `깨어 있었다 ${tally('awake')} (기록 밖이라 못 잰 것 ${unmeasured}개)`,
  );
  console.log(
    `  그중 망(net)으로 적힌 ${measured.filter(({ d }) => d.cause === 'net').length}개: ` +
      `잠 ${tally('asleep', 'net')} · 깬 직후 ${tally('just-woke', 'net')} · ` +
      `깨어 있었다 ${tally('awake', 'net')}` +
      (tally('awake', 'net') === 0 ? '  ← 깨어 있는 기계에서 죽은 망 사망은 없다' : ''),
  );
  console.log('');
}
