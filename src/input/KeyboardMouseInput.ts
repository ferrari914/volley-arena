import { normalize } from '../core/math';
import type { InputContext, InputSource, InputState } from './types';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * 데스크톱 입력. 터치와 같은 인터페이스로 맞춰 두면
 * 게임 쪽은 어떤 기기인지 알 필요가 없다.
 */
export class KeyboardMouseInput implements InputSource {
  private readonly pressed = new Set<string>();
  private mouse: { x: number; y: number } | null = null;

  constructor(private readonly host: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerleave', this.onPointerLeave);
  }

  read(context: InputContext): InputState {
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      const dir = MOVE_KEYS[code];
      if (!dir) continue;
      x += dir[0];
      y += dir[1];
    }
    const move = normalize({ x, y });

    let aim: { x: number; y: number } | null = null;
    if (this.mouse) {
      const ground = context.screenToGround(this.mouse.x, this.mouse.y);
      if (ground) {
        const dx = ground.x - context.playerPos.x;
        const dy = ground.y - context.playerPos.y;
        // 커서가 발밑에 있으면 방향이 정해지지 않는다. 그때는 자동 조준에 맡긴다.
        if (Math.hypot(dx, dy) > 0.6) aim = { x: dx, y: dy };
      }
    }

    return { move, aim };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.code in MOVE_KEYS)) return;
    event.preventDefault();
    this.pressed.add(event.code);
    document.body.dataset['input'] = 'keyboard';
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly onBlur = (): void => {
    // 창을 벗어나면 keyup을 못 받는다. 그대로 두면 키가 눌린 채로 남는다.
    this.pressed.clear();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    // 마우스가 움직였다는 것만으로 데스크톱임을 안다. 겨누는지와는 별개다.
    document.body.dataset['input'] = 'keyboard';
    // **아레나를 가리킨 것만 조준이다.** 카드·버튼·고르는 화면 위에서 움직인 것은
    // 아니다(DESIGN 1번 — 조준을 건드리지 않으면 가장 가까운 적을 자동 조준한다).
    // 그것까지 받으면 맵을 고르려고 마우스를 옮긴 사람이 판이 열리는 순간부터
    // 아무도 없는 그 자리를 겨누고 서 있게 된다 — 실제로 `npm run qa`의 데스크톱 화면이
    // 23초 동안 처치 0으로 그러고 있었다(세션 44).
    // HUD는 `#ui-layer`가 pointer-events:none이라 그 위를 지나도 여기 target은 캔버스다.
    if (!(event.target instanceof HTMLCanvasElement)) return;
    this.mouse = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    this.mouse = null;
  };
}
