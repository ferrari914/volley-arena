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
 * (3) 경험치바가 실제로 차는지 — DESIGN 3번.
 *     시뮬레이션이 경험치를 올리는 것은 단위 테스트가 보지만, 그 값이 화면까지
 *     오는지는 아무도 보지 않는다. HUD와 World 사이가 끊겨도 테스트는 전부 통과한다.
 *     그래서 실제 브라우저에서 코어를 주우러 걸어가 보고 바가 찼는지 잰다.
 *
 * (4) 레벨업 3중 1택 — DESIGN 4번.
 *     코어를 주워 레벨을 올리면 카드 3장이 뜨고, 그동안 게임이 멈추고,
 *     한 장을 누르면 카드가 사라지고 게임이 다시 흐르는지 화면에서 확인한다.
 *     "멈춘다"는 화면 시간(HUD)이 멈추는 것으로, "다시 흐른다"는 그 시간이 다시
 *     가는 것으로 잰다 — 멈춘 채로 영영 남는 고장은 이 기능의 가장 나쁜 고장이다.
 *
 * (5) 적이 실제로 쫓아와 쏘는지 — DESIGN 5번.
 *     적의 AI와 피해 계산은 단위 테스트가 보지만, 그것이 화면의 체력바까지 오는지는
 *     아무도 보지 않는다. 그래서 가만히 서서 기다려 보고 체력바가 실제로 줄어드는지 잰다.
 *     "서 있으면 맞는다"가 이 게임의 유일한 규칙이므로, 이게 화면에서 안 보이면
 *     플레이어는 왜 죽었는지 알 수 없다.
 *     그대로 서서 끝까지 기다려 쓰러진 화면까지 함께 본다 —
 *     죽은 뒤에 아무 일도 일어나지 않는 화면이 이 기능의 가장 나쁜 고장이다.
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
    // 가로 화면 두 종류에서만 코어를 주우러 가 본다(같은 검사를 다섯 번 할 이유가 없다).
    // 노치 화면까지 하는 이유는 레벨업 카드 세 장이 좌우 여백 안에 들어오는지 재기 위해서다.
    pickup: true,
    // 적이 쫓아와 쏘는지는 이 화면에서만 본다(DESIGN 5번). 이 게임의 기본 자세다.
    pressure: true,
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
    pickup: true,
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
    // 데스크톱에서는 키보드로 걸어가 코어를 줍고, 카드를 숫자키로 고른다.
    // 터치와 키보드는 서로 다른 경로다 — 한쪽만 보면 다른 쪽이 끊겨도 모른다.
    pickup: 'keyboard',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
];

/**
 * 안전 영역 안쪽에 있어야 하는 것들.
 * 화면에 보이지 않는 것(세로 안내처럼 다른 방향에서만 뜨는 것)은 검사에서 알아서 빠진다.
 */
const GUARDED = [
  ['위쪽 정보 줄', '#hud-top'],
  ['레벨 표시', '#hud-level'],
  ['체력바', '#hud-hp'],
  ['경험치바', '#hud-xp'],
  ['시간·처치', '#hud-stats'],
  ['진단 표시', '#hud-debug'],
  ['레벨업 알림', '#level-up'],
  ['조작 안내', '#hint'],
  ['업그레이드 안내', '#upgrade-head'],
  ['업그레이드 카드', '.up-card'],
  ['쓰러진 화면 제목', '#defeat-title'],
  ['다시 시작 버튼', '#defeat-again'],
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
        // 같은 이름의 것이 여럿일 수 있다(카드 3장). 하나만 재면 나머지가 넘쳐도 지나간다.
        const elements = [...document.querySelectorAll(selector)];
        for (const [index, element] of elements.entries()) {
          const name = elements.length > 1 ? `${label} ${index + 1}번째` : label;
          // 화면에 그려지지 않는 것은 검사 대상이 아니다.
          if (element.getClientRects().length === 0) continue;
          const style = getComputedStyle(element);
          if (Number(style.opacity) === 0 || style.visibility === 'hidden') continue;

          const rect = element.getBoundingClientRect();
          const over = [];
          // 0.5px은 소수점 반올림 여유. 그보다 큰 침범만 문제로 본다.
          if (rect.top < inset.top - 0.5) over.push(`위로 ${(inset.top - rect.top).toFixed(1)}px`);
          if (rect.left < inset.left - 0.5) {
            over.push(`왼쪽으로 ${(inset.left - rect.left).toFixed(1)}px`);
          }
          if (rect.right > width - inset.right + 0.5) {
            over.push(`오른쪽으로 ${(rect.right - (width - inset.right)).toFixed(1)}px`);
          }
          if (rect.bottom > height - inset.bottom + 0.5) {
            over.push(`아래로 ${(rect.bottom - (height - inset.bottom)).toFixed(1)}px`);
          }
          if (over.length > 0) {
            problems.push(`${name}(${selector})가 안전 영역을 ${over.join(', ')} 벗어났다`);
          }
        }
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

/** 손가락 하나짜리 터치. Playwright의 tap으로는 "끄는" 동작을 만들 수 없어 CDP로 보낸다. */
function touch(cdp, type, point) {
  return cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [{ x: point.x, y: point.y }] : [],
  });
}

/**
 * 코어를 주우러 걸어가 보고, 경험치바가 찼는지 본다.
 *
 * 한 방향으로만 걷지 않고 아레나를 네 방향으로 가로지른다(데스크톱 쪽과 같은 길).
 * 5번에서 적이 돌아다니기 시작한 뒤로는 코어가 어느 한 자리에 쌓이지 않는다 —
 * 적이 쓰러진 자리에 떨어지고, 그 자리는 매번 다르다.
 */
async function collectCores(page, cdp, viewport) {
  const origin = { x: 150, y: viewport.height - 90 };
  // 스틱 반지름(56px)보다 크게 끌어 최대 속도로 민다.
  const pull = 90;
  const legs = [
    { x: 0, y: -pull },
    { x: pull, y: 0 },
    { x: 0, y: pull },
    { x: -pull, y: 0 },
  ];

  for (let i = 0; i < 8; i += 1) {
    const leg = legs[i % legs.length];
    await touch(cdp, 'touchStart', origin);
    await page.waitForTimeout(80);
    await touch(cdp, 'touchMove', { x: origin.x + leg.x, y: origin.y + leg.y });
    await page.waitForTimeout(2400);
    await touch(cdp, 'touchEnd', null);
    if (await page.$('#upgrade[data-show="1"]')) break;
  }
  await page.waitForTimeout(250);

  return readXpBar(page);
}

/** 화면의 바가 얼마나 찼는지 읽는다. transform: scaleX(r)은 matrix(r,0,0,1,0,0)이 된다. */
function readBar(page, id) {
  return page.evaluate((barId) => {
    const fill = document.getElementById(barId);
    if (!fill) return null;
    const matrix = getComputedStyle(fill).transform;
    return matrix === 'none' ? 1 : Number(matrix.replace(/^matrix\(|\)$/g, '').split(',')[0]);
  }, id);
}

/**
 * 적이 쫓아와 쏘는지를 화면에서 확인한다 (DESIGN 5번).
 *
 * 가만히 서서 체력바가 줄기를 기다린다. 적은 걸어와야 하므로 곧바로 줄지는 않는다 —
 * 그래서 한 번 보고 끝내지 않고 정해진 시간까지 지켜본다.
 * 여기서 실패하면 셋 중 하나다: 적이 다가오지 않거나, 쏘지 않거나,
 * 맞은 것이 화면(HUD)까지 오지 않는다.
 */
async function checkEnemyPressure(page, name, problems) {
  const before = await readBar(page, 'hud-hp-fill');
  if (before === null) {
    problems.push(`[${name}] 체력바를 찾지 못했다`);
    return;
  }

  const deadline = Date.now() + 14000;
  let after = before;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    after = await readBar(page, 'hud-hp-fill');
    if (after !== null && after < before - 0.001) break;
    // 카드가 뜨면 게임이 멈춘다. 골라서 내리고 계속 기다린다.
    if (await page.$('#upgrade[data-show="1"]')) await page.keyboard.press('Digit1');
  }

  await page.screenshot({ path: `${OUT}/${name}-combat.png` });

  if (!(after < before - 0.001)) {
    problems.push(
      `[${name}] 가만히 서 있었는데 체력이 줄지 않았다 (체력바 ${before} 그대로) — ` +
        '적이 다가오지 않거나, 쏘지 않거나, 맞은 것이 화면까지 오지 않는다',
    );
    return;
  }
  console.log(`  적의 압박: 서 있는 동안 체력바 ${(before * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}%`);

  await checkDefeat(page, name, problems);
}

/**
 * 그대로 서서 끝까지 기다려 쓰러진 화면을 확인한다 (DESIGN 5번의 사망 처리).
 *
 * 세 가지를 본다: 화면이 뜨는가 · 그 뒤로 게임이 멈추는가 · 다시 시작할 길이 있는가.
 * 셋째를 반드시 함께 본다 — 죽은 채로 아무것도 할 수 없는 화면이 가장 나쁜 고장이다.
 */
async function checkDefeat(page, name, problems) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await page.$('#defeat[data-show="1"]')) break;
    // 카드가 뜨면 게임이 멈춘다. 골라서 내리고 계속 기다린다.
    if (await page.$('#upgrade[data-show="1"]')) await page.keyboard.press('Digit1');
    await page.waitForTimeout(500);
  }

  const shown = await page.evaluate(() => {
    const panel = document.querySelector('#defeat[data-show="1"]');
    if (!panel) return null;
    return {
      title: document.getElementById('defeat-title')?.textContent ?? '',
      summary: document.getElementById('defeat-summary')?.textContent ?? '',
      again: Boolean(document.getElementById('defeat-again')),
    };
  });

  if (!shown) {
    problems.push(`[${name}] 체력이 다 닳도록 서 있었는데 쓰러진 화면이 뜨지 않았다`);
    return;
  }
  await page.screenshot({ path: `${OUT}/${name}-defeat.png` });

  // 판이 끝났으므로 시계도 멈춰 있어야 한다.
  const before = await readClock(page);
  await page.waitForTimeout(700);
  if ((await readClock(page)) !== before) {
    problems.push(`[${name}] 쓰러졌는데 게임이 계속 흐른다 (${before})`);
  }
  // 도달 레벨·처치·생존 시간이 적혀 있어야 한다. 빈 요약은 "무엇을 했는지 모르는 끝"이다.
  if (!/레벨 \d+ · 처치 \d+ · \d+:\d\d 생존/.test(shown.summary)) {
    problems.push(`[${name}] 쓰러진 화면의 요약이 이상하다: "${shown.summary}"`);
  }
  if (!shown.again) {
    problems.push(`[${name}] 쓰러진 화면에 다시 시작할 길이 없다`);
  }
  console.log(`  쓰러진 화면: ${shown.title} — ${shown.summary}`);
}

/** 경험치바가 얼마나 찼는지 화면에서 읽는다. */
function readXpBar(page) {
  return page.evaluate(() => {
    const fill = document.getElementById('hud-xp-fill');
    const level = document.getElementById('hud-level');
    if (!fill || !level) return { error: '경험치바를 찾지 못했다' };
    // transform: scaleX(r) 은 matrix(r, 0, 0, 1, 0, 0) 으로 계산된다.
    const matrix = getComputedStyle(fill).transform;
    const ratio = matrix === 'none' ? 0 : Number(matrix.replace(/^matrix\(|\)$/g, '').split(',')[0]);
    return { ratio, level: level.textContent ?? '' };
  });
}

/**
 * 데스크톱: 키보드로 아레나를 돌아다니며 코어를 줍는다(터치 쪽 `collectCores`와 같은 길).
 *
 * 한 방향으로만 걸으면 벽에 붙어 선 채로 더 줍지 못하고, 잘게 왔다 갔다 하면
 * 제자리를 맴돌아 아무것도 못 줍는다(둘 다 해 보고 실패했다). 한 번에 아레나를
 * 가로지를 만큼(2.4초 ≒ 17m)씩 네 방향으로 걷는다. 카드가 뜨면 곧바로 멈춘다.
 */
async function collectCoresWithKeyboard(page) {
  const keys = ['KeyW', 'KeyS', 'KeyD', 'KeyA'];
  for (let i = 0; i < 8; i += 1) {
    const key = keys[i % keys.length];
    await page.keyboard.down(key);
    await page.waitForTimeout(2400);
    await page.keyboard.up(key);
    if (await page.$('#upgrade[data-show="1"]')) break;
  }
  await page.waitForTimeout(250);
  return readXpBar(page);
}

/** HUD 위쪽 줄의 시간·처치 문구. 게임이 흐르고 있는지를 화면에서 읽는 유일한 값이다. */
function readClock(page) {
  return page.evaluate(() => document.getElementById('hud-stats')?.textContent ?? '');
}

/**
 * 레벨업 3중 1택(DESIGN 4번)을 화면에서 확인한다.
 * 코어를 주워 레벨이 오른 직후에 부른다 — 그 시점에 카드가 떠 있어야 한다.
 *
 * 세 가지를 본다: 카드가 3장 떴는가 · 그동안 게임이 멈추는가 · 누르면 다시 흐르는가.
 * "멈춘다"만 보면 영영 멈춰 버린 화면도 통과하므로 "다시 흐른다"를 반드시 함께 본다.
 */
async function checkUpgradeCards(page, name, problems, pickCard) {
  const opened = await page.evaluate(() => {
    const panel = document.querySelector('#upgrade[data-show="1"]');
    if (!panel) return { open: false };
    const cards = [...panel.querySelectorAll('.up-card')];
    return {
      open: true,
      count: cards.length,
      head: document.getElementById('upgrade-head')?.textContent ?? '',
      titles: cards.map((card) => card.querySelector('.up-card__title')?.textContent ?? ''),
    };
  });

  if (!opened.open) {
    problems.push(
      `[${name}] 레벨이 올랐는데 3중 1택 카드가 뜨지 않았다 — World와 화면 사이가 끊겼다`,
    );
    return;
  }
  if (opened.count !== 3) {
    problems.push(`[${name}] 카드가 3장이 아니라 ${opened.count}장 떴다`);
    return;
  }

  // ① 멈추는가. 화면의 시계가 멈춰 있어야 한다.
  const before = await readClock(page);
  await page.waitForTimeout(700);
  const during = await readClock(page);
  if (before !== during) {
    problems.push(`[${name}] 카드가 떠 있는데 게임이 계속 흐른다 (${before} → ${during})`);
  }

  await page.screenshot({ path: `${OUT}/${name}-cards.png` });

  // ② 누르면 사라지는가. 카드 한가운데를 손가락으로 누른다.
  // 한 번에 두 레벨이 오르면 고른 직후 다음 카드가 이어서 뜬다(그게 맞는 동작이다).
  // 그래서 "사라졌다"는 남은 선택이 0이 될 때까지 눌러 본 뒤에 판단한다.
  let picks = 0;
  while (picks < 6) {
    if (!(await pickCard())) {
      problems.push(`[${name}] 카드의 자리를 찾지 못했다`);
      return;
    }
    await page.waitForTimeout(300);
    picks += 1;
    const open = await page.evaluate(() => {
      const panel = document.querySelector('#upgrade[data-show="1"]');
      return panel ? Number(panel.dataset.remaining) : 0;
    });
    if (!open) break;
  }

  const stillOpen = await page.evaluate(() =>
    Boolean(document.querySelector('#upgrade[data-show="1"]')),
  );
  if (stillOpen) {
    problems.push(`[${name}] 카드를 ${picks}번 눌렀는데 사라지지 않는다`);
    return;
  }

  // ③ 다시 흐르는가. 여기까지 봐야 "멈춘 채로 남는" 고장을 잡는다.
  await page.waitForTimeout(700);
  const after = await readClock(page);
  if (after === during) {
    problems.push(`[${name}] 카드를 고른 뒤에도 게임이 멈춰 있다 (${during} 그대로)`);
  }

  console.log(`  3중 1택: ${opened.titles.join(' · ')} — ${opened.head} (${picks}장 고름)`);
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

    if (view.pickup) {
      const keyboard = view.pickup === 'keyboard';
      const result = keyboard
        ? await collectCoresWithKeyboard(page)
        : await collectCores(page, await context.newCDPSession(page), view.viewport);
      if (result.error) {
        problems.push(`[${name}] 코어 줍기: ${result.error}`);
      } else if (!(result.ratio > 0) && result.level === 'Lv 1') {
        problems.push(
          `[${name}] 코어를 주우러 걸어갔는데 경험치바가 그대로다 (바 ${result.ratio}, ${result.level}) — ` +
            'World와 HUD 사이가 끊겼거나 코어를 못 먹는다',
        );
      } else {
        console.log(`  코어 줍기: 경험치바 ${(result.ratio * 100).toFixed(0)}% · ${result.level}`);
      }
      await page.screenshot({ path: `${OUT}/${name}-xp.png` });

      // 카드가 떠 있는 지금이 카드 배치를 재기에 맞는 시점이다(고르면 사라진다).
      for (const problem of await measureSafeArea(page, safe, GUARDED)) {
        problems.push(`[${name}] 안전 영역(카드): ${problem}`);
      }
      // 카드를 고르는 방법도 화면마다 다르다: 손가락으로 누르거나, 숫자키 1을 누르거나.
      await checkUpgradeCards(page, name, problems, async () => {
        if (keyboard) {
          await page.keyboard.press('Digit1');
          return true;
        }
        const box = await page.locator('.up-card').first().boundingBox();
        if (!box) return false;
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      });
    }

    // 적의 압박은 화면 하나에서만 본다. 입력 경로(터치/키보드)와 상관없는 검사라
    // 여러 화면에서 되풀이해도 같은 코드를 다시 볼 뿐이고, 화면마다 14초씩 붙는다.
    if (view.pressure) await checkEnemyPressure(page, name, problems);

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
