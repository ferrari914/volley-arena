import { Ticker } from './core/Ticker';
import { World } from './core/World';
import { InputManager } from './input/InputManager';
import { Renderer } from './render/Renderer';
import { Defeat } from './ui/Defeat';
import { Hud } from './ui/Hud';
import { UpgradeCards } from './ui/UpgradeCards';
import { IDLE_INPUT } from './input/types';

declare global {
  interface Window {
    /**
     * 입력 지연 측정용 훅. `tools/latency.mjs`가 페이지가 뜨기 전에 심어 두고,
     * 게임은 한 프레임을 다 그린 직후에 그 시점의 World를 넘겨 준다.
     * 심어 두지 않으면(=평소에는) 아무 일도 하지 않는다.
     *
     * 왜 필요한가: "입력이 몇 번째 프레임에 화면에 반영됐는가"는 프레임 안에서만
     * 알 수 있다. 바깥에서 폴링하면 프레임 경계를 놓쳐 아무 값이나 나온다.
     * World를 통째로 넘기는 이유: 나중에 다른 값을 재고 싶어질 때
     * 게임 쪽 코드를 다시 고치지 않아도 되게 한다.
     */
    __frameProbe?: (world: World) => void;
  }
}

function showFatal(message: string): void {
  const layer = document.getElementById('ui-layer');
  if (!layer) return;
  const box = document.createElement('div');
  box.id = 'hint';
  box.style.top = '50%';
  box.style.pointerEvents = 'auto';
  box.textContent = message;
  layer.appendChild(box);
}

function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiLayer = document.getElementById('ui-layer');
  const app = document.getElementById('app');
  if (!(canvas instanceof HTMLCanvasElement) || !uiLayer || !app) {
    throw new Error('필요한 DOM 요소를 찾지 못했다');
  }

  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas);
  } catch {
    showFatal('이 브라우저에서 WebGL을 켤 수 없다. 다른 브라우저에서 열어 달라.');
    return;
  }

  const world = new World();
  const frameProbe = window.__frameProbe;
  const hud = new Hud(uiLayer);
  const cards = new UpgradeCards(uiLayer, (id) => world.chooseUpgrade(id));
  const defeat = new Defeat(uiLayer);
  const input = new InputManager(app);

  const ticker = new Ticker(
    (dt) => {
      // 카드를 고르는 동안과 쓰러진 뒤에는 입력을 읽지 않는다. 멈춤 자체는 World가
      // 지키지만(step이 빈다), 화면의 버튼을 누르려고 댄 손가락이 가상 스틱으로 새는 것은
      // 여기서 막아야 한다.
      if (world.isPaused) return;

      const state = document.hidden
        ? IDLE_INPUT
        : input.read({
            playerPos: world.player.pos,
            screenToGround: (x, y) => renderer.screenToGround(x, y),
          });
      world.step(state, dt);
    },
    () => {
      renderer.sync(world);
      renderer.render();
      hud.update(world, ticker.fps);
      cards.sync(world.offer);
      defeat.sync(world);
      frameProbe?.(world);
    },
  );

  // 세로 화면에서는 "돌려 주세요" 안내가 화면을 덮는다(style.css와 같은 조건).
  // 보이지도 않는 화면을 계속 그리면 배터리만 깎는다.
  const portrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');

  const syncRunning = (): void => {
    if (document.hidden || portrait.matches) ticker.stop();
    else ticker.start();
  };

  portrait.addEventListener('change', syncRunning);
  document.addEventListener('visibilitychange', syncRunning);
  syncRunning();
}

boot();
