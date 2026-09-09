import { REVIVE } from '../data/config';

/**
 * 리워드 광고 자리 — 지금은 더미다 (DESIGN 6번: "실제 광고 연동 전까지는
 * 더미 화면으로 흐름만 완성해 둔다". 실제 연동은 DESIGN 11번이 이 자리를 가져간다).
 *
 * **이 화면이 따로 있는 이유는 흐름의 모양을 미리 맞춰 두기 위해서다.**
 * 진짜 리워드 광고는 (1) 끝까지 봐야 보상을 주고, (2) 도중에 닫으면 주지 않으며,
 * (3) 언제든 실패할 수 있다. 그래서 `show()`는 "보상을 줄 것인가"를 Promise<boolean>로
 * 돌려준다 — 11번에서 안쪽만 SDK 호출로 갈아 끼우면 부르는 쪽은 그대로 둘 수 있다.
 *
 * 닫기(×)를 처음부터 열어 두는 이유: 기다림 없이 빠져나갈 길이 없는 화면은
 * 광고가 아니라 고장으로 읽힌다. 대신 그때는 보상이 없다(false).
 */
export class AdBreak {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly countdown: HTMLElement;

  /** 지금 도는 광고를 끝내는 손잡이. 광고가 떠 있지 않으면 null. */
  private finish: ((rewarded: boolean) => void) | null = null;
  private timer = 0;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'adbreak';

    const tag = document.createElement('div');
    tag.id = 'adbreak-tag';
    tag.textContent = '광고';
    this.root.appendChild(tag);

    const label = document.createElement('div');
    label.id = 'adbreak-label';
    label.textContent = '광고를 보면 그 자리에서 이어서 합니다';
    this.root.appendChild(label);

    this.countdown = document.createElement('div');
    this.countdown.id = 'adbreak-countdown';
    this.root.appendChild(this.countdown);

    const track = document.createElement('div');
    track.id = 'adbreak-bar';
    this.bar = document.createElement('div');
    this.bar.id = 'adbreak-bar-fill';
    track.appendChild(this.bar);
    this.root.appendChild(track);

    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'adbreak-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '광고 닫기 (이어하기 취소)');
    close.addEventListener('click', () => this.end(false));
    this.root.appendChild(close);

    host.appendChild(this.root);
  }

  /** 광고를 띄운다. 끝까지 보면 true, 도중에 닫으면 false. */
  show(): Promise<boolean> {
    // 이미 떠 있으면 새로 띄우지 않는다(버튼이 두 번 눌린 경우).
    if (this.finish) return Promise.resolve(false);

    this.root.dataset['show'] = '1';
    const started = performance.now();
    const total = REVIVE.adSeconds * 1000;
    this.paint(total, total);

    return new Promise<boolean>((resolve) => {
      this.finish = resolve;
      this.timer = window.setInterval(() => {
        const left = total - (performance.now() - started);
        this.paint(Math.max(left, 0), total);
        if (left <= 0) this.end(true);
      }, 100);
    });
  }

  private paint(left: number, total: number): void {
    this.countdown.textContent = `${Math.ceil(left / 1000)}초`;
    this.bar.style.transform = `scaleX(${(1 - left / total).toFixed(4)})`;
  }

  private end(rewarded: boolean): void {
    const finish = this.finish;
    if (!finish) return;
    this.finish = null;
    window.clearInterval(this.timer);
    delete this.root.dataset['show'];
    finish(rewarded);
  }
}
