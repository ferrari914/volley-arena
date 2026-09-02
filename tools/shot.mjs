/**
 * 화면 QA: 실제 브라우저로 게임을 띄워 스크린샷을 남기고, 콘솔 에러를 잡는다.
 *
 *   npm run qa
 *
 * DESIGN 품질 기준 "게임 중 어떤 상황에서도 콘솔에 에러가 찍히지 않을 것"을
 * 사람이 매번 확인할 수 없어서 검사로 만들어 둔 것이다.
 * 콘솔 에러나 처리되지 않은 예외가 하나라도 있으면 0이 아닌 코드로 끝난다.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const PORT = 4183;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = 'shots';

/** 찍을 화면들. 모바일 가로가 첫 번째 기준이다. */
const VIEWS = [
  {
    name: 'mobile-landscape',
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  },
  {
    name: 'mobile-portrait',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  },
  {
    name: 'desktop',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
];

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 아직 안 떴다. 다시 시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 뜨지 않았다: ${url}`);
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: 'ignore' },
);

const problems = [];

try {
  await waitForServer(URL);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  for (const view of VIEWS) {
    const { name, ...contextOptions } = view;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`[${name}] console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`[${name}] pageerror: ${error.message}`));

    await page.goto(URL, { waitUntil: 'load' });
    // 자동 조준이 대상을 잡고 화살이 날아가는 장면을 담는다.
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${name}.png` });

    // 이동 입력이 실제로 먹는지: 왼쪽 아래를 끌어 본다(터치) / WASD(데스크톱).
    if (view.hasTouch) {
      await page.touchscreen.tap(120, view.viewport.height - 90);
      await page.waitForTimeout(200);
    } else {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(600);
      await page.keyboard.up('KeyD');
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${name}-input.png` });

    await context.close();
  }

  await browser.close();
} finally {
  server.kill();
}

if (problems.length > 0) {
  console.error('화면 QA 실패 — 콘솔 에러가 있다:');
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}

console.log(`화면 QA 통과. 스크린샷: ${OUT}/`);
