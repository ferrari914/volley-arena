import type { InputContext, InputSource, InputState } from './types';
import { KeyboardMouseInput } from './KeyboardMouseInput';
import { TouchInput } from './TouchInput';

/**
 * 터치와 키보드·마우스를 하나로 합친다.
 * 두 입력을 합칠 때 이동은 값이 있는 쪽을 쓰고, 조준은 터치가 우선한다 —
 * 태블릿처럼 둘 다 달린 기기에서 손가락이 마우스에 밀려나면 안 된다.
 */
export class InputManager implements InputSource {
  private readonly touch: TouchInput;
  private readonly desktop: KeyboardMouseInput;

  constructor(host: HTMLElement) {
    this.touch = new TouchInput(host);
    this.desktop = new KeyboardMouseInput(host);
    document.body.dataset['input'] = 'keyboard';
  }

  read(context: InputContext): InputState {
    const touch = this.touch.read();
    const desktop = this.desktop.read(context);
    const touching = touch.move.x !== 0 || touch.move.y !== 0;
    return {
      move: touching ? touch.move : desktop.move,
      aim: touch.aim ?? (this.touch.wasUsed ? null : desktop.aim),
    };
  }

  dispose(): void {
    this.touch.dispose();
    this.desktop.dispose();
  }
}
