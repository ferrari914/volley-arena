/**
 * 창을 열면 아레나를 고르는 화면이 먼저 뜬다(DESIGN 10번 · `ui/MapSelect.ts`).
 * 도구는 게임을 보러 온 것이므로, 그 화면을 눌러 판을 연다.
 *
 * **도구 셋(`shot`·`enemy-shot`·`latency`)이 같은 함수를 쓴다.** 각자 고르는 코드를
 * 갖고 있으면, 고르는 화면이 바뀐 날 하나만 고쳐 두고 나머지 둘은 조용히 멈춰 선다 —
 * 판이 안 열린 채로 찍은 화면은 "게임이 멈췄다"로 읽힌다.
 *
 * **기본 맵(`open`)을 고른다.** 지금까지 쌓인 fps·지연·밸런스 수치가 전부 그 맵의 것이라,
 * 여기서 다른 맵을 고르면 도구가 어제와 다른 게임을 재게 된다.
 */

/** 고르는 화면이 뜨기를 기다리는 시간(ms). 첫 그림이 뜨는 데 드는 시간까지 넉넉히 준다. */
const APPEAR_TIMEOUT = 10000;

/**
 * 맵을 골라 판을 연다. 고르는 화면이 아예 없으면(도구가 게임보다 앞서 갔거나
 * 화면이 지워졌으면) 던진다 — 조용히 지나가면 그다음 실패가 엉뚱한 곳에서 난다.
 *
 * @param {import('playwright').Page} page
 * @param {string} [mapId] 고를 맵의 이름표(`data/maps.ts`). 기본값은 기본 맵.
 */
export async function startMatch(page, mapId = 'open') {
  // 세로 화면에서는 `#rotate-notice`가 화면을 덮어 카드가 보이기는 해도 눌리지 않는다
  // (그것이 이 게임의 세로 화면이다). 여기서 먼저 말해 주지 않으면 30초 뒤에
  // "element is not stable"만 남아, 다음 사람이 이유를 처음부터 찾게 된다.
  if (await page.locator('#rotate-notice').isVisible()) {
    throw new Error(
      '세로 화면이라 돌려 달라는 안내(#rotate-notice)가 고르는 화면을 덮고 있다 — ' +
        '판을 열려면 가로 화면으로 열어라',
    );
  }
  const card = page.locator(`#map-card-${mapId}`);
  await card.waitFor({ state: 'visible', timeout: APPEAR_TIMEOUT });
  // **손가락이 달린 화면은 손가락으로 누른다.** `click()`은 터치 기기를 흉내 내는
  // 화면에서도 마우스 이벤트를 낸다 — 그러면 게임은 그 순간부터 그 화면을
  // 데스크톱으로 보고(`body[data-input='keyboard']`) 가상 스틱을 숨긴 채 "WASD로 이동"이라고
  // 말한다. 도구가 마우스로 시작한 탓에 모바일 화면 전부가 데스크톱 화면으로 찍히던 자리다.
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
    const box = await card.boundingBox();
    if (!box) throw new Error('맵 카드의 자리를 잴 수 없다 — 화면에 떠 있지 않다');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await card.click();
  }
  // 누른 뒤 판이 실제로 열렸는지 본다. 두 번 눌리는 것을 MapSelect가 막으므로
  // 여기서는 사라지기만 기다리면 된다.
  await page.locator('#map-select').waitFor({ state: 'hidden', timeout: APPEAR_TIMEOUT });
}
