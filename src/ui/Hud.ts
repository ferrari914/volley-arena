import type { World } from '../core/World';
import { xpRatio } from '../systems/experience';

/** 조작 안내가 사라지기까지의 시간(s). 처음 하는 사람이 읽을 만큼만 띄운다. */
const HINT_SECONDS = 6;
/** 레벨업 표시가 화면에 머무는 시간(s). */
const LEVEL_UP_SECONDS = 1.4;

/**
 * 화면 위쪽 한 줄: 레벨 · 경험치바 · 시간/처치 · 진단(fps·조준).
 * 체력바는 5번(적 봇)에서 이 줄에 붙는다.
 *
 * 한 줄에 몰아 둔 이유: 가로 화면의 세로 길이는 390px밖에 안 되고,
 * 아래쪽 절반은 엄지손가락과 가상 스틱의 자리다(DESIGN 화면 구성).
 */
export class Hud {
  private readonly level: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly levelUp: HTMLElement;

  private hintHidden = false;
  private lastLevel = 1;
  private levelUpTimer = 0;
  private lastElapsed = 0;

  constructor(host: HTMLElement) {
    const top = document.createElement('div');
    top.id = 'hud-top';

    this.level = document.createElement('div');
    this.level.id = 'hud-level';
    this.level.textContent = 'Lv 1';
    top.appendChild(this.level);

    const bar = document.createElement('div');
    bar.id = 'hud-xp';
    this.xpFill = document.createElement('div');
    this.xpFill.id = 'hud-xp-fill';
    bar.appendChild(this.xpFill);
    top.appendChild(bar);

    this.stats = document.createElement('div');
    this.stats.id = 'hud-stats';
    top.appendChild(this.stats);

    this.readout = document.createElement('div');
    this.readout.id = 'hud-debug';
    top.appendChild(this.readout);

    host.appendChild(top);

    this.levelUp = document.createElement('div');
    this.levelUp.id = 'level-up';
    this.levelUp.textContent = 'LEVEL UP';
    host.appendChild(this.levelUp);

    this.hint = document.createElement('div');
    this.hint.id = 'hint';
    this.hint.textContent = '왼쪽으로 이동 · 오른쪽으로 조준 · 코어를 주우면 레벨이 오른다';
    host.appendChild(this.hint);
  }

  update(world: World, fps: number): void {
    const seconds = world.elapsed;
    // 화면 시간이 아니라 시뮬레이션 시간으로 잰다. 탭이 멈추면 게임도 멈춘다.
    const frameSeconds = Math.max(seconds - this.lastElapsed, 0);
    this.lastElapsed = seconds;

    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    this.stats.textContent = `${mm}:${ss.toString().padStart(2, '0')}   처치 ${world.hits}`;
    this.readout.textContent = `${Math.round(fps)}fps ${world.lockedTarget ? '자동' : '수동'}`;

    const progress = world.progress;
    if (progress.level !== this.lastLevel) {
      this.lastLevel = progress.level;
      this.level.textContent = `Lv ${progress.level}`;
      this.levelUpTimer = LEVEL_UP_SECONDS;
      // 애니메이션을 다시 태우려면 클래스를 한 번 떼었다 붙여야 한다.
      this.level.classList.remove('is-up');
      void this.level.offsetWidth;
      this.level.classList.add('is-up');
      this.levelUp.dataset.show = '1';
    }
    if (this.levelUpTimer > 0) {
      this.levelUpTimer -= frameSeconds;
      if (this.levelUpTimer <= 0) delete this.levelUp.dataset.show;
    }

    // 폭이 아니라 scaleX로 늘린다. 폭을 건드리면 매 프레임 레이아웃을 다시 계산한다.
    this.xpFill.style.transform = `scaleX(${xpRatio(progress).toFixed(4)})`;

    if (!this.hintHidden && seconds > HINT_SECONDS) {
      this.hintHidden = true;
      this.hint.style.opacity = '0';
      window.setTimeout(() => this.hint.remove(), 600);
    }
  }
}
