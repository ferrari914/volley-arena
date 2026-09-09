/**
 * 화면 QA: 실제 브라우저로 게임을 띄워 스크린샷을 남기고, 두 가지를 자동으로 잡는다.
 *
 *   npm run qa
 *
 * (1) 콘솔 에러 — DESIGN 품질 기준 "게임 중 어떤 상황에서도 콘솔에 에러가 찍히지 않을 것".
 * (2) 안전 영역(노치) 침범 — DESIGN A-2 "안전 영역(노치) 회피".
 *     노치가 있는 기기는 화면 네 변에 시스템이 쓰는 여백이 있고, 그 위에 놓인 UI는
 *     잘리거나 상태바에 가린다. 실기기가 없어도 확인할 수 있도록 여백 값을 주입해
 *     흉내 내고, HUD와 가상 스틱이 그 안쪽에 있는지 좌표로 잰다.
 *     주입 방식이라 `env(safe-area-inset-*)` 자체가 동작하는지는 증명하지 못한다 —
 *     증명하는 것은 "여백이 주어졌을 때 화면 배치가 그 여백을 지키는가"다.
 *
 * 문제가 하나라도 있으면 0이 아닌 코드로 끝난다.
 */
import { mkdir, rm } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { startPreview } from './lib/preview.mjs';

const PORT = 4183;
const OUT = 'shots';

/**
 * 안전 영역 여백(CSS px). iPhone 13 사파리에서 관측되는 값을 기준으로 잡았다.
 * 가로에서는 노치가 어느 쪽에 오는지 기기 방향에 따라 달라지므로 양쪽 다 준다.
 */
const SAFE = {
  none: { top: 0, right: 0, bottom: 0, left: 0 },
  landscape: { top: 0, right: 47, bottom: 21, left: 47 },
  portrait: { top: 47, right: 0, bottom: 34, left: 0 },
};

const IPHONE_UA = devices['iPhone 13'].userAgent;

/** 찍을 화면들. 모바일 가로가 첫 번째 기준이다. */
const VIEWS = [
  {
    name: 'mobile-landscape',
    safe: SAFE.none,
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  },
  {
    // 노치 기기의 가로 화면. 이 게임의 기본 자세이므로 가장 중요한 화면이다.
    name: 'mobile-landscape-notch',
    safe: SAFE.landscape,
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  },
  {
    name: 'mobile-portrait',
    safe: SAFE.none,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  },
  {
    name: 'mobile-portrait-notch',
    safe: SAFE.portrait,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  },
  {
    name: 'desktop',
    safe: SAFE.none,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
];

/**
 * 안전 영역 안쪽에 있어야 하는 것들.
 * 화면에 보이지 않는 것(세로 안내처럼 다른 방향에서만 뜨는 것)은 검사에서 알아서 빠진다.
 */
const GUARDED = [
  ['좌상단 표시', '#hud-debug'],
  ['조작 안내', '#hint'],
  ['이동 스틱', '.stick--move'],
  ['조준 스틱', '.stick--aim'],
  ['세로 안내 문구', '#rotate-notice p'],
];

/** 안전 영역 여백을 :root 인라인 스타일로 주입한다(스타일시트의 env() 값을 덮는다). */
async function applySafeArea(page, safe) {
  await page.evaluate((inset) => {
    const root = document.documentElement;
    root.style.setProperty('--safe-t', `${inset.top}px`);
    root.style.setProperty('--safe-r', `${inset.right}px`);
    root.style.setProperty('--safe-b', `${inset.bottom}px`);
    root.style.setProperty('--safe-l', `${inset.left}px`);
  }, safe);
}

/** 보이는 UI가 안전 영역을 침범했는지 잰다. 침범한 것들의 설명을 돌려준다. */
function measureSafeArea(page, safe, guarded) {
  return page.evaluate(
    ({ inset, items }) => {
      const problems = [];
      const width = window.innerWidth;
      const height = window.innerHeight;

      for (const [label, selector] of items) {
        const element = document.querySelector(selector);
        if (!element) continue;
        // 화면에 그려지지 않는 것은 검사 대상이 아니다.
        if (element.getClientRects().length === 0) continue;
        const style = getComputedStyle(element);
        if (Number(style.opacity) === 0 || style.visibility === 'hidden') continue;

        const rect = element.getBoundingClientRect();
        const over = [];
        // 0.5px은 소수점 반올림 여유. 그보다 큰 침범만 문제로 본다.
        if (rect.top < inset.top - 0.5) over.push(`위로 ${(inset.top - rect.top).toFixed(1)}px`);
        if (rect.left < inset.left - 0.5) over.push(`왼쪽으로 ${(inset.left - rect.left).toFixed(1)}px`);
        if (rect.right > width - inset.right + 0.5) {
          over.push(`오른쪽으로 ${(rect.right - (width - inset.right)).toFixed(1)}px`);
        }
        if (rect.bottom > height - inset.bottom + 0.5) {
          over.push(`아래로 ${(rect.bottom - (height - inset.bottom)).toFixed(1)}px`);
        }
        if (over.length > 0) problems.push(`${label}(${selector})가 안전 영역을 ${over.join(', ')} 벗어났다`);
      }

      // 3D 화면은 반대로 화면을 꽉 채워야 한다. 여백이 생기면 리사이즈 처리가 잘못된 것이다.
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < width - 0.5 || rect.height < height - 0.5) {
          problems.push(
            `게임 화면이 창을 채우지 못했다: ${rect.width.toFixed(1)}x${rect.height.toFixed(1)} (창 ${width}x${height})`,
          );
        }
      }
      return problems;
    },
    { inset: safe, items: guarded },
  );
}

const problems = [];
const preview = await startPreview(PORT);

try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  for (const view of VIEWS) {
    const { name, safe, ...contextOptions } = view;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`[${name}] console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`[${name}] pageerror: ${error.message}`));

    await page.goto(preview.url, { waitUntil: 'load' });
    await applySafeArea(page, safe);
    // 자동 조준이 대상을 잡고 화살이 날아가는 장면을 담는다.
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${name}.png` });

    // 이동 입력이 실제로 먹는지: 왼쪽 아래를 끌어 본다(터치) / WASD(데스크톱).
    // 터치는 가상 스틱을 켜는 역할도 한다 — 스틱은 손가락이 한 번 닿아야 보인다.
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

    // 스틱이 쉬는 자리로 돌아온 지금이 배치를 재기에 맞는 시점이다.
    for (const problem of await measureSafeArea(page, safe, GUARDED)) {
      problems.push(`[${name}] 안전 영역: ${problem}`);
    }

    await context.close();
  }

  await browser.close();
} finally {
  preview.stop();
}

if (problems.length > 0) {
  console.error('화면 QA 실패:');
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}

console.log(`화면 QA 통과 (화면 ${VIEWS.length}종, 안전 영역 검사 포함). 스크린샷: ${OUT}/`);
