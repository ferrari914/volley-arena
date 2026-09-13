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
    // 아무도 아직 손을 대기 전에도 어느 기기인지 가려 둔다. 이 값 하나로
    // 가상 스틱과 조작 안내가 갈리는데, 둘 다 판이 열리는 **첫 화면**에 있는 것들이다
    // — 무조건 'keyboard'로 두면 전화기에서 첫 6초 동안 "WASD로 이동"이 뜬다.
    // 주 포인터가 굵으면(손가락) 터치로 본다. 손가락이 닿거나 마우스가 움직이면
    // 그쪽이 이 값을 다시 덮어쓰므로, 여기서 틀려도 한 번의 입력으로 바로잡힌다.
    document.body.dataset['input'] = window.matchMedia('(pointer: coarse)').matches
      ? 'touch'
      : 'keyboard';
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
