import { Ticker } from './core/Ticker';
import { World } from './core/World';
import { InputManager } from './input/InputManager';
import { Renderer } from './render/Renderer';
import { Hud } from './ui/Hud';
import { IDLE_INPUT } from './input/types';

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
  const hud = new Hud(uiLayer);
  const input = new InputManager(app);

  const ticker = new Ticker(
    (dt) => {
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
    },
  );

  ticker.start();

  // 탭이 가려진 동안에는 프레임을 돌리지 않는다. 배터리를 갉아먹을 이유가 없다.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ticker.stop();
    else ticker.start();
  });
}

boot();
