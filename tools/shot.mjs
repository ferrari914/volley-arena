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
 * (7) 결과 화면과 기록 저장 — DESIGN 7번.
 *     쓰러진 화면에 이번 판(레벨·처치·생존)과 최고 기록이 같은 모양으로 적히는지,
 *     그 최고 기록이 **브라우저에 실제로 남는지**(화면 숫자와 저장된 값을 맞춰 본다),
 *     그리고 **이어한 판은 기록에 오르지 않는지**를 확인한다.
 *     화면만 보면 기억 속 변수 하나로도 통과한다 — 그건 새로고침에 사라지는 기록이다.
 *
 * (6) 쓰러진 뒤의 두 갈래 — DESIGN 6번.
 *     이어하기(광고)를 눌러 그 자리에서 레벨을 지킨 채 이어지는지, 다시 쓰러진 뒤
 *     처음부터를 눌러 1레벨의 새 판이 도는지 화면에서 확인한다.
 *     둘을 갈라놓는 값(레벨)을 함께 재지 않으면 두 버튼이 같은 일을 해도 통과한다.
 *
 * 문제가 하나라도 있으면 0이 아닌 코드로 끝난다.
 */
import { mkdir, rm } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { startPreview } from './lib/preview.mjs';

const PORT = 4183;
const OUT = 'shots';

/** 결과 화면 한 줄의 모양. 이번 판과 최고 기록이 같은 모양이어야 눈으로 견줄 수 있다. */
const RESULT_LINE = /^레벨 (\d+) · 처치 (\d+) · (\d+:\d\d) 생존$/;
/** 최고 기록이 저장되는 자리(src/data/records.ts와 같은 값). */
const RECORD_KEY = 'volley-arena:best:v1';
/**
 * 전투를 보는 화면에 미리 심어 두는 "지난 기록".
 *
 * 심는 이유는 둘이다. (1) 처음 여는 브라우저에는 기록이 없어서, 아무것도 안 심으면
 * **기록을 갈아치우는 장면 — 두 번째 판부터 늘 보게 되는 그 화면 — 을 한 번도 보지 못한다.**
 * (2) 심은 값이 화면에 그대로 나오면 저장한 값을 도로 읽어 오는 길까지 확인된다.
 * 이 판은 5레벨쯤에서 끝나므로 반드시 이 기록을 넘어선다.
 */
const SEEDED_RECORD = { level: 2, kills: 3, time: 11 };
const SEEDED_LINE = '레벨 2 · 처치 3 · 0:11 생존';

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
  ['이어하기 버튼', '#defeat-revive'],
  ['처음부터 버튼', '#defeat-again'],
  ['갈래 설명', '.defeat-note'],
  ['광고 안내', '#adbreak-label'],
  ['광고 닫기', '#adbreak-close'],
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
 * 그대로 서서 끝까지 기다려 쓰러진 화면을 확인하고, **거기서 나가는 두 갈래를 다 걸어 본다**
 * (DESIGN 6번 — 사망 · 리스폰 · 부활).
 *
 *   ① 쓰러진 화면이 뜨는가 · 그 뒤로 시계가 멈추는가 · 요약이 적히는가
 *   ② 이어하기(광고) — 광고가 뜨고, 끝나면 그 자리에서 다시 흐르고, **레벨이 그대로인가**
 *   ③ 처음부터    — 다시 쓰러진 뒤 누르면 1레벨부터 다시 흐르는가
 *
 * ②의 "레벨이 그대로"와 ③의 "1레벨부터"가 이 기능의 전부다. 화면이 다시 흐르는 것만
 * 보면 두 버튼이 같은 일을 해도 통과한다 — 실제로 둘을 갈라놓는 값을 함께 잰다.
 */
async function checkDefeat(page, name, problems) {
  const fall = await waitForDefeat(page);
  if (!fall.fell) {
    problems.push(
      `[${name}] 서 있는데 ${fall.why}` +
        (fall.stalled ? '' : ` — "움직이면 피하고 서 있으면 죽는다"(DESIGN 5번)가 흔들렸다`),
    );
    return;
  }

  const shown = await readResult(page);
  await page.screenshot({ path: `${OUT}/${name}-defeat.png` });

  // 판이 끝났으므로 시계도 멈춰 있어야 한다.
  const stopped = await readClock(page);
  await page.waitForTimeout(FROZEN_WAIT);
  if ((await readClock(page)) !== stopped) {
    problems.push(`[${name}] 쓰러졌는데 게임이 계속 흐른다 (${stopped})`);
  }
  // 도달 레벨·처치·생존 시간이 적혀 있어야 한다. 빈 결과는 "무엇을 했는지 모르는 끝"이다.
  if (!RESULT_LINE.test(shown.run)) {
    problems.push(`[${name}] 결과 화면의 "이번 판"이 이상하다: "${shown.run}"`);
  }
  // 이어하기 없이 끝낸 판이고 심어 둔 지난 기록(2레벨)보다 멀리 갔으므로 기록을 세워야 한다.
  if (shown.noteKind !== 'new') {
    problems.push(
      `[${name}] 지난 기록(${SEEDED_LINE})을 넘어섰는데 새 기록으로 치지 않았다 (안내 "${shown.note}")`,
    );
  }
  // 그 지난 기록이 화면에 그대로 나와야 한다 — 저장한 값을 도로 읽어 오는 길의 확인이다.
  if (shown.best !== SEEDED_LINE) {
    problems.push(
      `[${name}] 심어 둔 지난 기록이 화면에 나오지 않는다 (기대 "${SEEDED_LINE}" / 화면 "${shown.best}") — ` +
        '저장은 되는데 다시 읽어 오지 못한다면 기록은 새로고침마다 사라진다',
    );
  }
  checkStoredRecord(shown, name, problems);

  if (!shown.revive || !shown.again) {
    problems.push(
      `[${name}] 쓰러진 화면에 두 갈래가 다 있지 않다 (이어하기 ${shown.revive}, 처음부터 ${shown.again})`,
    );
    return;
  }
  console.log(`  결과 화면: ${shown.title} — 이번 판 ${shown.run} · "${shown.note}"`);
  if (shown.taken) console.log(`  고른 카드: ${shown.taken}`);

  const levelAtDeath = await readLevel(page);
  await checkRevive(page, name, problems, levelAtDeath);
  await checkRestart(page, name, problems, shown.stored);
}

/** 결과 화면(DESIGN 7번)이 적은 값들. 저장소에 실제로 남았는지까지 함께 읽는다. */
function readResult(page) {
  return page.evaluate((key) => {
    const text = (id) => document.getElementById(id)?.textContent ?? '';
    let stored;
    try {
      stored = localStorage.getItem(key);
    } catch {
      // 저장이 막힌 브라우저. 여기서 터지면 QA가 화면 대신 예외를 본다.
      stored = null;
    }
    return {
      title: text('defeat-title'),
      run: text('defeat-run'),
      best: text('defeat-best'),
      note: text('defeat-record-note'),
      noteKind: document.getElementById('defeat-record-note')?.dataset.kind ?? '',
      taken: text('defeat-taken'),
      stored,
      revive: Boolean(document.getElementById('defeat-revive')),
      again: Boolean(document.getElementById('defeat-again')),
    };
  }, RECORD_KEY);
}

/**
 * 화면에 적힌 최고 기록이 **브라우저에 실제로 남았는지** 확인한다 (DESIGN 7번 "기록 저장").
 *
 * 화면만 보면 기억 속 변수 하나로도 통과한다 — 그건 새로고침 한 번에 사라지는 기록이다.
 * 저장소를 직접 읽어 화면의 숫자와 맞춰 본다.
 */
function checkStoredRecord(shown, name, problems) {
  if (!shown.stored) {
    problems.push(`[${name}] 최고 기록이 브라우저에 저장되지 않았다 (${RECORD_KEY} 없음)`);
    return;
  }
  let record;
  try {
    record = JSON.parse(shown.stored);
  } catch {
    problems.push(`[${name}] 저장된 최고 기록을 읽을 수 없다: ${shown.stored}`);
    return;
  }
  // 기록을 세운 판에서는 "이번 판" 줄이 곧 최고 기록이다(둘째 줄은 넘어선 지난 기록).
  const line = shown.noteKind === 'new' ? shown.run : shown.best;
  const onScreen = line.match(RESULT_LINE);
  if (!onScreen) return;
  if (Number(onScreen[1]) !== record.level || Number(onScreen[2]) !== record.kills) {
    problems.push(
      `[${name}] 화면의 기록과 저장된 값이 다르다 (화면 "${line}" / 저장 ${shown.stored})`,
    );
    return;
  }
  console.log(`  기록 저장: ${shown.stored}`);
}

/** HUD 시계("m:ss   처치 n")에서 게임 시간을 초로 읽는다. 못 읽으면 null. */
function clockSeconds(text) {
  const match = /(\d+):(\d\d)/.exec(text ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * 가만히 서서 쓰러질 때까지 기다린다. 카드가 뜨면 곧바로 골라서 내린다 —
 * 안 고르면 게임이 멈춘 채로 영영 죽지 않는다.
 *
 * **기다리는 한도를 게임 시간(HUD 시계)으로 잰다.** 실제 시간으로 재면 두 가지가 섞인다:
 * 카드가 떠 있는 동안은 게임이 멈춰 있고(그게 맞는 동작이다), 강해질수록 처치가 늘어
 * 카드가 자주 떠서 그 몫이 커진다. 다중 발사 카드(DESIGN 8번)를 넣은 바퀴에 이 검사가
 * 실제로 여기서 헛디뎠다 — 게임 안에서는 40초 만에 쓰러지는데 실제 시간은 60초를 넘었다.
 *
 * 실제 시간은 화면이 아예 멈춰 버린 경우를 잡는 안전선으로만 쓴다(게임 시간이 안 흐르면
 * 게임 시간 한도에는 영영 닿지 않으므로, 이쪽이 없으면 검사가 끝나지 않는다).
 *
 * **그 안전선이 재는 자 노릇을 하고 있었다(세션 31).** 전에는 "벽시계 240초"에 걸려도 게임 시간
 * 한도에 걸린 것과 똑같이 `false` 하나를 돌려줬고, 실패 문구는 늘 **"게임 시간 150초가 지나도록"**
 * 이라고 말했다. 그런데 이 기계에서 판이 도는 속도는 프레임에 묶여 있다 —
 * 카드가 떠 있는 동안 게임이 멈추고, 소프트웨어 렌더러가 느려지면 게임 시간이 벽시계보다 늦게 간다.
 * **즉 기계가 느린 판까지 "게임이 흔들렸다"로 적힌다.** 둘은 고칠 자리가 정반대다.
 *
 * 그래서 벽시계로는 **흐르는가**만 본다(`FROZEN_LIMIT` 동안 시계가 한 칸도 안 넘어가면 멈춘 것이다).
 * 원래 이 선이 잡으려던 것이 그것이고, 이 편이 더 빨리(240초가 아니라 20초) 잡아낸다.
 * `WALL_CAP`은 영영 안 끝나는 일만 막는 마지막 선이라 넉넉히 둔다.
 */
const FROZEN_LIMIT = 20;
const WALL_CAP = 600;

/**
 * **페이지가 대답하지 않는 것과 게임이 멈춘 것은 다른 고장이다**(세션 31).
 * 실제로 겪었다: 시계가 멈춘 것을 20초에 잡아야 하는데 **515초**가 걸렸다 —
 * 시계를 읽는 `page.evaluate` 자체가 그동안 돌아오지 않았기 때문이다.
 * 즉 멈춘 것은 게임 루프가 아니라 브라우저 쪽이었고, 그 사실이 문구에 한 글자도 없었다.
 * 그래서 묻는 쪽에 한도를 건다 — 이쪽이 걸리면 게임이 아니라 **이 기계의 헤드리스 브라우저**다.
 */
const REPLY_LIMIT = 30;

function withReplyLimit(promise, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`페이지가 ${REPLY_LIMIT}초 동안 대답하지 않는다 (${what})`)),
        REPLY_LIMIT * 1000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * **시계가 멈췄을 때 왜 멈췄는지를 화면에서 직접 묻는다**(세션 31).
 *
 * 게임이 시계를 세우는 길은 둘뿐이다.
 *   (1) `World.isPaused` — 카드가 떴거나 쓰러졌다. 그러면 `body[data-paused]`가 붙는다.
 *   (2) `document.hidden` — `main.ts`의 `syncRunning`이 **틱 자체를 멈춘다.**
 *       탭이 뒤로 가면 배터리를 안 쓰는 것이 맞는 동작이지만, **헤드리스에서는
 *       사람이 아무 짓도 안 했는데 페이지가 뒤로 가 있을 수 있다** — 그러면 판은
 *       멀쩡한데 시계만 서고, 재는 자에게는 "게임이 안 끝난다"로 보인다.
 * 둘 다 아니면 남는 것은 브라우저가 프레임을 못 그리고 있다는 뜻이다.
 */
async function readWhyStopped(page) {
  try {
    const state = await withReplyLimit(
      page.evaluate(() => ({
        hidden: document.hidden,
        visibility: document.visibilityState,
        paused: document.body.dataset.paused === '1',
        card: Boolean(document.querySelector('#upgrade[data-show="1"]')),
        defeat: Boolean(document.querySelector('#defeat[data-show="1"]')),
        ad: Boolean(document.querySelector('#adbreak[data-show="1"]')),
      })),
      '왜 멈췄는지 묻기',
    );
    if (state.hidden) return `페이지가 뒤로 가 있다(visibilityState ${state.visibility}) — 틱이 멈춘다`;
    if (state.card) return '카드가 떠 있는데 안 내려간다';
    if (state.defeat) return '쓰러진 화면이 떠 있다';
    if (state.ad) return '광고 화면이 떠 있다';
    if (state.paused) return 'body[data-paused]는 붙어 있는데 덮은 화면이 없다';
    return '멈춘 화면이 없다 — 브라우저가 프레임을 못 그리고 있다';
  } catch (error) {
    return error.message;
  }
}

async function waitForDefeat(page, gameLimit = 150) {
  const startedWall = Date.now();
  const started = clockSeconds(await readClock(page)) ?? 0;
  let game = 0;
  let lastMoved = Date.now();
  for (;;) {
    let now;
    try {
      if (await withReplyLimit(page.$('#defeat[data-show="1"]'), '쓰러진 화면')) {
        return { fell: true };
      }
      if (await withReplyLimit(page.$('#upgrade[data-show="1"]'), '카드 화면')) {
        await withReplyLimit(page.keyboard.press('Digit1'), '카드 고르기');
      }
      now = clockSeconds(await withReplyLimit(readClock(page), '시계 읽기'));
    } catch (error) {
      return { fell: false, stalled: true, why: `${error.message} — 게임이 아니라 브라우저가 멈췄다` };
    }
    if (now !== null && now - started !== game) {
      game = now - started;
      lastMoved = Date.now();
    }
    if (game > gameLimit) {
      return { fell: false, why: `게임 시간 ${game}초가 지나도록 쓰러지지 않았다` };
    }

    const frozen = (Date.now() - lastMoved) / 1000;
    if (frozen > FROZEN_LIMIT) {
      return {
        fell: false,
        stalled: true,
        why:
          `게임 시계가 ${frozen.toFixed(0)}초 동안 ${game}초에 멈춰 서 있다 ` +
          `(${await readWhyStopped(page)})`,
      };
    }
    const wall = (Date.now() - startedWall) / 1000;
    if (wall > WALL_CAP) {
      return {
        fell: false,
        stalled: true,
        why:
          `벽시계 ${wall.toFixed(0)}초를 다 쓰는 동안 게임 시간은 ${game}초만 흘렀다 ` +
          `(${(game / wall).toFixed(2)}배 · ${await readWhyStopped(page)})`,
      };
    }
    // 카드를 빨리 내릴수록 게임 시간과 실제 시간이 가깝게 흐른다(멈춰 있는 몫이 줄어든다).
    await page.waitForTimeout(150);
  }
}

/**
 * 이어하기(광고 · DESIGN 6번의 부활).
 * 광고 화면이 뜨는가 → 끝나면 그 자리에서 다시 흐르는가 → **레벨과 카드를 지켰는가**.
 */
async function checkRevive(page, name, problems, levelAtDeath) {
  await page.click('#defeat-revive');
  await page.waitForTimeout(300);

  if (!(await page.$('#adbreak[data-show="1"]'))) {
    problems.push(`[${name}] 이어하기를 눌렀는데 광고 화면이 뜨지 않았다`);
    return;
  }
  await page.screenshot({ path: `${OUT}/${name}-ad.png` });
  // 광고가 도는 동안에는 아직 살아나면 안 된다. 여기서 이미 흐르면 광고는 장식이다.
  if (!(await page.$('#defeat[data-show="1"]'))) {
    problems.push(`[${name}] 광고가 끝나기도 전에 쓰러진 화면이 내려갔다`);
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && (await page.$('#adbreak[data-show="1"]'))) {
    await page.waitForTimeout(250);
  }
  if (await page.$('#adbreak[data-show="1"]')) {
    problems.push(`[${name}] 광고가 끝나지 않는다 — 빠져나갈 길이 없는 화면이다`);
    return;
  }

  const before = await readClock(page);
  const after = await waitForClockChange(page, before);
  if (after === null) {
    problems.push(`[${name}] 이어하기를 했는데 게임이 멈춰 있다 (${before} 그대로)`);
    return;
  }
  if (await page.$('#defeat[data-show="1"]')) {
    problems.push(`[${name}] 이어하기를 했는데 쓰러진 화면이 그대로 덮고 있다`);
    return;
  }

  const hp = await readBar(page, 'hud-hp-fill');
  if (!(hp > 0.99)) problems.push(`[${name}] 이어하기를 했는데 체력이 차지 않았다 (${hp})`);

  // 여기가 이어하기의 전부다: 쌓아 온 것을 들고 간다.
  const level = await readLevel(page);
  if (level !== levelAtDeath) {
    problems.push(
      `[${name}] 이어하기인데 레벨이 초기화됐다 (${levelAtDeath} → ${level}) — 처음부터와 같은 일을 한다`,
    );
  }
  await page.screenshot({ path: `${OUT}/${name}-revived.png` });
  console.log(`  이어하기: 광고 뒤 그 자리에서 다시 흐른다 (${levelAtDeath} 유지 · ${before} → ${after})`);
}

/**
 * 처음부터(DESIGN 6번의 리스폰). 다시 쓰러뜨린 뒤 눌러, 1레벨부터 새 판이 도는지 본다.
 *
 * 두 번째 죽음은 **이어하기로 이어 간 판의 끝**이다. 그래서 여기서 기록 규칙도 함께 잰다:
 * 이어한 판은 아무리 멀리 가도 최고 기록을 건드리지 않는다(DESIGN 7번의 결정).
 */
async function checkRestart(page, name, problems, storedBefore) {
  const fall = await waitForDefeat(page);
  if (!fall.fell) {
    problems.push(`[${name}] 이어한 뒤 다시 서 있었는데 ${fall.why}`);
    return;
  }

  const second = await readResult(page);
  await page.screenshot({ path: `${OUT}/${name}-defeat-revived.png` });
  // 이어한 판은 더 멀리 갔지만(레벨도 처치도 늘었다) 저장된 기록은 그대로여야 한다.
  if (second.stored !== storedBefore) {
    problems.push(
      `[${name}] 이어한 판이 최고 기록에 올랐다 (${storedBefore} → ${second.stored}) — ` +
        '광고를 볼수록 기록이 자라면 그 숫자는 실력을 뜻하지 않는다',
    );
  }
  if (!RESULT_LINE.test(second.best)) {
    problems.push(`[${name}] 이어한 판의 결과 화면에 최고 기록이 없다: "${second.best}"`);
  }
  if (!/이어하기 \d+회/.test(second.note)) {
    problems.push(
      `[${name}] 이어한 판인데 왜 기록에 안 오르는지가 화면에 없다 (안내: "${second.note}") — ` +
        '저장이 고장 난 것과 구별되지 않는다',
    );
  } else {
    console.log(`  이어한 판: 기록 그대로 (${second.best}) · 안내 "${second.note}"`);
  }

  await page.click('#defeat-again');
  // 새 판의 첫 모습은 곧바로 잰다. 여기서 검사가 오래 기다리면 그사이에 진짜로 맞는다 —
  // 서 있는 사람에게는 새 판에서도 1.3초쯤에 첫 화살이 꽂힌다(그게 이 게임의 규칙이다).
  await page.waitForTimeout(350);

  if (await page.$('#defeat[data-show="1"]')) {
    problems.push(`[${name}] 처음부터를 눌렀는데 쓰러진 화면이 그대로다`);
    return;
  }

  const level = await readLevel(page);
  if (level !== 'Lv 1') {
    problems.push(`[${name}] 처음부터인데 레벨이 남아 있다 (${level}) — 전부 초기화가 아니다`);
  }
  const hp = await readBar(page, 'hud-hp-fill');
  if (!(hp > 0.99)) problems.push(`[${name}] 새 판인데 체력이 가득 차 있지 않다 (${hp})`);

  const clock = await readClock(page);
  if (!/^0:0[0-9]/.test(clock)) {
    problems.push(`[${name}] 처음부터인데 시계가 처음부터 가지 않는다 (${clock})`);
  }
  await page.screenshot({ path: `${OUT}/${name}-restart.png` });

  if ((await waitForClockChange(page, clock)) === null) {
    problems.push(`[${name}] 처음부터를 눌렀는데 새 판이 흐르지 않는다 (${clock} 그대로)`);
  }
  console.log(`  처음부터: ${level} · ${clock}부터 새 판이 돈다`);
}

/** HUD의 레벨 표시. 이어하기와 처음부터를 가르는 값이다. */
function readLevel(page) {
  return page.evaluate(() => document.getElementById('hud-level')?.textContent ?? '');
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
 * **시계는 초 단위로만 적힌다.** 그래서 "잠깐 기다렸다 견준다"로는 흐르는지를 잴 수 없다 —
 * 1초 눈금을 넘지 못한 기다림은 **도는 게임도 멈춘 것으로 읽는다.**
 * 세션 20에 `npm run qa`가 실제로 여기서 두 번 걸렸다(이어하기 뒤 900ms 기다림).
 * 브라우저로 확인해 보니 시계는 1.05초마다 또박또박 넘어가고 있었다.
 *
 * 그래서 기다리는 시간을 늘리는 대신 **바뀔 때까지 기다린다.** 진짜로 멈춘 화면은
 * 한도까지 가서 걸리므로 검사가 무뎌지지 않는다(오히려 빨라진다 — 흐르면 곧바로 돌아온다).
 *
 * 흐르면 바뀐 문구를, 한도 안에 안 바뀌면 null.
 */
async function waitForClockChange(page, before, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const now = await readClock(page);
    if (now !== before) return now;
  }
  return null;
}

/**
 * 반대쪽("멈춰 있는가")을 잴 때 기다리는 시간(ms).
 * 1초 눈금을 확실히 넘기고도 그대로여야 멈춘 것이다 — 700ms로 재면
 * 흐르는 시계도 열 번에 세 번은 멈춘 것으로 보인다.
 */
const FROZEN_WAIT = 1400;

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
  await page.waitForTimeout(FROZEN_WAIT);
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
  if ((await waitForClockChange(page, during)) === null) {
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
    if (view.pressure) {
      // 지난 기록을 하나 심고 다시 연다. 이 화면에서만 쓰러질 때까지 가므로 여기서만 심는다.
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [RECORD_KEY, JSON.stringify(SEEDED_RECORD)],
      );
      await page.reload({ waitUntil: 'load' });
    }
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
