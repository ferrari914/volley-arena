/** 임시: 돌진형이 웅크렸다 몸을 던지는 장면을 눈으로 보기 위한 연속 촬영. */
import { chromium } from 'playwright';
import { startPreview } from './lib/preview.mjs';

const preview = await startPreview(4185);
try {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
  await page.goto(preview.url, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  for (let i = 0; i < 26; i += 1) {
    await page.screenshot({ path: `shots/tmp-charger-${String(i).padStart(2, '0')}.png` });
    await page.waitForTimeout(140);
  }
  await browser.close();
} finally {
  preview.stop();
}
