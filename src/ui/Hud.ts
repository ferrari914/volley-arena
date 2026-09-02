import type { World } from '../core/World';

/** 조작 안내가 사라지기까지의 시간(s). 처음 하는 사람이 읽을 만큼만 띄운다. */
const HINT_SECONDS = 6;

/**
 * 지금은 진단용 표시만 있다.
 * 체력바·경험치바·레벨은 3번(경험치)과 5번(적)에서 붙는다.
 */
export class Hud {
  private readonly readout: HTMLElement;
  private readonly hint: HTMLElement;
  private hintHidden = false;

  constructor(host: HTMLElement) {
    this.readout = document.createElement('div');
    this.readout.id = 'hud-debug';
    host.appendChild(this.readout);

    this.hint = document.createElement('div');
    this.hint.id = 'hint';
    this.hint.textContent = '왼쪽으로 이동 · 오른쪽으로 조준 · 화살은 알아서 나간다';
    host.appendChild(this.hint);
  }

  update(world: World, fps: number): void {
    const seconds = world.elapsed;
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    const aimMode = world.lockedTarget ? '자동' : '수동';
    this.readout.textContent = [
      `${mm}:${ss.toString().padStart(2, '0')}`,
      `명중 ${world.hits}`,
      `조준 ${aimMode}`,
      `${Math.round(fps)} fps`,
    ].join('   ');

    if (!this.hintHidden && seconds > HINT_SECONDS) {
      this.hintHidden = true;
      this.hint.style.opacity = '0';
      window.setTimeout(() => this.hint.remove(), 600);
    }
  }
}
