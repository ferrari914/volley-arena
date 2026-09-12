/**
 * 입력 지연 측정: 터치가 화면에 반영되기까지 얼마나 걸리는지 잰다.
 *
 *   npm run latency
 *
 * DESIGN 품질 기준 "터치 입력과 화면 반응 사이에 체감되는 지연이 없을 것"과
 * A-2(모바일 기준선)의 "터치 반응 지연 없음"을 확인하는 검사다.
 *
 * ── 어떻게 재는가
 * 왼쪽 아래에 손가락을 대고(이때는 스틱 값이 0이라 플레이어가 서 있다) 옆으로 끈다.
 * 그 pointermove가 페이지에 도착한 시각부터, 플레이어 좌표가 달라진 첫 프레임을
 * 다 그린 시각까지를 본다. 좌표는 게임 안에서 프레임마다 `window.__frameProbe`로
 * 꺼내 온다 — 바깥에서 폴링하면 프레임 경계를 놓친다.
 *
 * ── 무엇을 합격/불합격으로 보는가
 * 핵심은 **"붙들린 프레임"이 0인가**다. 이벤트가 도착한 뒤에 시뮬레이션이 한 번이라도
 * 돈 프레임은 그 입력을 반영해야 한다. 돌았는데 반영하지 않았다면 게임이 입력을
 * 한 프레임 쌓아 둔 것이고, 그게 우리가 만들어 낼 수 있는 유일한 종류의 지연이다.
 *
 * 프레임 수를 그대로 합격선에 쓰지 않는 이유: 이 루프는 1/60초 고정 스텝이라
 * 화면이 60Hz보다 빠르면 어떤 프레임은 시뮬레이션을 한 번도 돌리지 않는다(=그릴 게 없다).
 * 그런 프레임을 "밀렸다"고 세면 120Hz 기기가 60Hz 기기보다 나빠 보인다. 실제로는
 * 둘 다 "다음 스텝에 바로 반영"으로 같다. 그래서 프레임 수는 참고로만 찍는다.
 *
 * ── 재지 못하는 것 (이 수치로 주장하면 안 되는 것)
 * (1) 그리기가 끝난 뒤 화면에 실제로 불이 들어오기까지(합성·GPU·패널)는 브라우저 밖이라
 *     재지 못한다. "총 지연 N ms"라고 말하지 마라.
 * (2) 여기 렌더러는 소프트웨어(swiftshader)라 프레임 간격이 실기기와 다르다.
 *     그래서 ms 합격선도 절대값이 아니라 "잰 프레임 간격 기준"으로 잡는다.
 * (3) 터치는 CDP로 밀어 넣은 합성 이벤트다. 브라우저가 이벤트를 페이지에 넘기기까지의
 *     시간에는 실제 손가락에는 없는 프로세스 간 통신이 섞여 있다.
 * 말할 수 있는 것은 "게임이 입력을 붙들고 있지 않다"까지다.
 *
 * 문제가 하나라도 있으면 0이 아닌 코드로 끝난다.
 */
import { chromium, devices } from 'playwright';
import { startPreview } from './lib/preview.mjs';
import { acquireBrowserLock, LOCK_BUSY_EXIT } from './lib/lock.mjs';

const PORT = 4184;

/** 표본 수. 이벤트가 프레임의 어느 지점에 떨어지느냐가 매번 달라서 여러 번 재야 한다. */
const SAMPLES = 30;

/** 스틱을 끄는 거리(px). 스틱 반지름(56)보다 작게 잡아 최대치로 튀지 않게 한다. */
const DRAG = 40;

/** 시뮬레이션 한 스텝(ms). `src/core/Ticker.ts`의 fixedDt와 같아야 한다. */
const STEP_MS = 1000 / 60;

/** 이 게임의 기본 자세인 모바일 가로 화면에서 잰다. */
const VIEWPORT = { width: 844, height: 390 };

/**
 * 픽셀 배율은 1로 둔다(화면 QA는 3을 쓴다).
 * 소프트웨어 렌더러라 배율을 올리면 그릴 픽셀이 9배가 되고 프레임이 느려진다.
 * 프레임이 느릴수록 매 프레임 시뮬레이션이 반드시 돌아 검사가 헐거워지기만 한다.
 */
const SCALE = 1;

function quantile(sorted, q) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), max: sorted[sorted.length - 1] };
}

/**
 * 페이지가 뜨기 전에 심는 관찰자.
 *
 * requestAnimationFrame을 감싸 "그 프레임의 콜백이 실제로 시작한 시각"을 남긴다.
 * rAF가 인자로 주는 시각(vsync)이 아니라 실행 시각이어야 하는 이유:
 * 이벤트 핸들러는 프레임 콜백과 다른 태스크에서 돈다. 둘 중 어느 쪽이 먼저 돌았는지를
 * 가르는 것은 vsync 시각이 아니라 실행 시각이다.
 */
function installProbe() {
  const probe = { frames: [], events: [] };
  let frameStart = 0;

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      frameStart = performance.now();
      callback(time);
    });

  window.__frameProbe = (world) => {
    probe.frames.push({
      start: frameStart,
      end: performance.now(),
      x: world.player.pos.x,
      y: world.player.pos.y,
      // 이 프레임까지 시뮬레이션이 몇 초어치 돌았는지. 프레임당 스텝 수를 여기서 뽑는다.
      elapsed: world.elapsed,
    });
  };

  // capture 단계라 게임의 핸들러보다 먼저 돈다. 둘은 같은 태스크 안이므로,
  // 여기서 잰 시각 이후에 시작한 프레임은 이미 새 입력값을 보고 있다.
  window.addEventListener(
    'pointermove',
    (event) => probe.events.push({ arrived: performance.now(), stamp: event.timeStamp }),
    { capture: true },
  );

  window.__probe = probe;
}

/** 프레임이 최소 count개 더 지나갈 때까지 기다린다. */
async function waitFrames(page, count) {
  const from = await page.evaluate(() => window.__probe.frames.length);
  await page.waitForFunction(
    ({ from, count }) => window.__probe.frames.length >= from + count,
    { from, count },
    { timeout: 5000 },
  );
}

/** 손가락 하나짜리 터치. Playwright의 tap으로는 끄는 동작을 만들 수 없어 CDP로 보낸다. */
function touch(cdp, type, point) {
  return cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [{ x: point.x, y: point.y }] : [],
  });
}

/**
 * 레벨업 카드(DESIGN 4번)가 떠 있으면 골라서 내린다.
 * 카드가 떠 있는 동안 게임은 일부러 멈춰 있어 손가락을 끌어도 플레이어가 움직이지 않는다.
 * 그건 입력 지연이 아니라 멈춤이므로, 재기 전에 걷어 내야 엉뚱한 실패로 끝나지 않는다.
 */
function dismissUpgradeCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector('#upgrade[data-show="1"] .up-card');
    if (!card) return false;
    card.click();
    return true;
  });
}

/**
 * 한 번 재기: 손가락을 대고(움직임 없음) → 옆으로 끌고 → 플레이어가 움직인 첫 프레임을 찾는다.
 * 방향을 번갈아 주는 이유: 같은 쪽으로만 밀면 플레이어가 아레나 벽에 붙어 더 이상 안 움직인다.
 */
async function measureOnce(page, cdp, index) {
  if (await dismissUpgradeCard(page)) await waitFrames(page, 2);

  const start = { x: 150, y: VIEWPORT.height - 90 };
  await touch(cdp, 'touchStart', start);
  await waitFrames(page, 3);

  // 끌기 직전의 좌표가 기준점이다. 손가락을 댔을 뿐이면 플레이어는 서 있다.
  const baseline = await page.evaluate(() => {
    const frames = window.__probe.frames;
    const last = frames[frames.length - 1];
    // 분석은 이 프레임의 "다음"부터 한다. 한 칸 앞을 남겨 둬야 스텝 수를 뺄 수 있다.
    return last ? { index: frames.length - 1, x: last.x, y: last.y } : null;
  });
  if (!baseline) throw new Error('프레임이 한 번도 그려지지 않았다');

  const drag = { x: start.x + (index % 2 === 0 ? DRAG : -DRAG), y: start.y };
  await touch(cdp, 'touchMove', drag);

  try {
    await page.waitForFunction(
      (base) =>
        window.__probe.frames.slice(base.index + 1).some((f) => f.x !== base.x || f.y !== base.y),
      baseline,
      { timeout: 3000 },
    );
  } catch {
    throw new Error(
      `손가락을 ${DRAG}px 끌었는데 플레이어가 움직이지 않았다 (${index + 1}번째). ` +
        '측정이 아니라 조작이 고장 난 것이다.',
    );
  }

  const result = await page.evaluate(
    ({ base, stepMs }) => {
      const { frames, events } = window.__probe;
      const event = events[events.length - 1];
      if (!event) return { error: 'pointermove 이벤트가 페이지에 도착하지 않았다' };

      let held = 0; // 시뮬레이션이 돌았는데도 입력을 반영하지 않은 프레임 수
      let idle = 0; // 시뮬레이션이 한 번도 안 돈 프레임 수 (60Hz보다 빠른 화면에서 생긴다)
      let seen = 0; // 이벤트 도착 뒤에 지나간 프레임 수
      const intervals = [];

      for (let i = base.index + 1; i < frames.length; i += 1) {
        const frame = frames[i];
        const previous = frames[i - 1];
        intervals.push(frame.start - previous.start);
        // 이벤트보다 먼저 시작한 프레임은 이미 옛 입력값을 읽은 뒤라 반영될 수가 없다.
        if (frame.start <= event.arrived) continue;

        seen += 1;
        const steps = Math.round(((frame.elapsed - previous.elapsed) * 1000) / stepMs);
        const reflected = frame.x !== base.x || frame.y !== base.y;
        if (reflected) {
          intervals.sort((a, b) => a - b);
          return {
            held,
            idle,
            frameDelay: seen,
            steps,
            waitMs: frame.end - event.arrived,
            deliveryMs: event.arrived - event.stamp,
            interval: intervals[intervals.length >> 1],
          };
        }
        if (steps > 0) held += 1;
        else idle += 1;
      }
      return { error: '반영된 프레임을 이벤트 이후에서 찾지 못했다' };
    },
    { base: baseline, stepMs: STEP_MS },
  );

  await touch(cdp, 'touchEnd', null);
  // 손을 뗀 뒤 멈춰 서기까지 몇 프레임 준다. 다음 표본의 기준점이 흔들리지 않게.
  await waitFrames(page, 3);

  if (result.error) throw new Error(`${result.error} (${index + 1}번째)`);
  return result;
}

// 브라우저 도구는 한 번에 하나만 돈다(`lib/lock.mjs` 머리말을 보라).
// 겹쳐 돌면 값이 틀리는 정도가 아니라, **틀린 값이 게임 이야기로 문서에 남는다.**
try {
  acquireBrowserLock('npm run latency (latency.mjs)');
} catch (error) {
  console.error(error.message);
  process.exit(LOCK_BUSY_EXIT);
}

const problems = [];
const preview = await startPreview(PORT);

try {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.addInitScript(installProbe);
  await page.goto(preview.url, { waitUntil: 'load' });

  const cdp = await context.newCDPSession(page);
  await waitFrames(page, 10);

  const samples = [];
  try {
    for (let i = 0; i < SAMPLES; i += 1) samples.push(await measureOnce(page, cdp, i));
  } finally {
    await browser.close();
  }

  const held = samples.reduce((sum, s) => sum + s.held, 0);
  const frameDelay = summarize(samples.map((s) => s.frameDelay));
  const wait = summarize(samples.map((s) => s.waitMs));
  const delivery = summarize(samples.map((s) => s.deliveryMs));
  const interval = summarize(samples.map((s) => s.interval));

  // 기다림의 한도: 최악의 경우 "이벤트가 스텝 직후에 떨어져 다음 스텝을 통째로 기다리고,
  // 그 뒤 한 프레임을 그리는" 만큼이다. 프레임 간격은 기계마다 달라 잰 값을 그대로 쓴다.
  const waitLimit = STEP_MS + interval.max * 2;

  console.log(`입력 지연 (표본 ${samples.length}개, 모바일 가로 ${VIEWPORT.width}x${VIEWPORT.height})`);
  console.log(`  붙들린 프레임  ${held}개  (합격선 0 — 시뮬레이션이 돌았는데 입력이 반영 안 된 프레임)`);
  console.log(
    '  반영까지 기다림  중앙값 %sms · p95 %sms · 최악 %sms  (합격선 %sms)',
    wait.median.toFixed(1),
    wait.p95.toFixed(1),
    wait.max.toFixed(1),
    waitLimit.toFixed(1),
  );
  console.log(
    '  반영까지 프레임 수  중앙값 %d · 최악 %d  (참고 — 화면이 60Hz보다 빠르면 늘어난다)',
    frameDelay.median,
    frameDelay.max,
  );
  console.log(
    '  이 기계의 프레임 간격  중앙값 %sms ≒ %s fps  ·  이벤트 전달 중앙값 %sms (합성 입력이라 실기기 값이 아니다)',
    interval.median.toFixed(1),
    (1000 / interval.median).toFixed(0),
    delivery.median.toFixed(1),
  );

  if (held > 0) {
    problems.push(`입력을 붙들고 있는 프레임이 ${held}개 있다 — 게임이 입력을 한 프레임 쌓아 두고 있다`);
  }
  if (wait.max > waitLimit) {
    problems.push(`반영까지 기다림 최악 ${wait.max.toFixed(1)}ms > 합격선 ${waitLimit.toFixed(1)}ms`);
  }
  // 값이 음수거나 터무니없으면 시계를 잘못 읽은 것이다. 그 상태의 "통과"는 통과가 아니다.
  if (!(wait.median > 0) || !Number.isFinite(interval.median)) {
    problems.push(`시간 값이 이상하다: 기다림 중앙값 ${wait.median} · 프레임 간격 ${interval.median}`);
  }
} finally {
  preview.stop();
}

if (problems.length > 0) {
  console.error('입력 지연 측정 실패:');
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}

console.log('입력 지연 통과.');
