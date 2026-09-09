import type { World } from '../core/World';
import { xpRatio } from '../systems/experience';

/** 조작 안내가 사라지기까지의 시간(s). 처음 하는 사람이 읽을 만큼만 띄운다. */
const HINT_SECONDS = 6;
/** 레벨업 표시가 화면에 머무는 시간(s). */
const LEVEL_UP_SECONDS = 1.4;

/**
 * 화면 위쪽 한 줄: 레벨 · 체력바/경험치바 · 시간/처치 · 진단(fps·조준).
 *
 * 한 줄에 몰아 둔 이유: 가로 화면의 세로 길이는 390px밖에 안 되고,
 * 아래쪽 절반은 엄지손가락과 가상 스틱의 자리다(DESIGN 화면 구성).
 * 두 바는 위아래로 겹쳐 쌓는다 — 나란히 놓으면 각각이 절반 길이가 되어
 * 작은 화면에서 얼마나 찼는지 읽히지 않는다. 위가 체력, 아래가 경험치다.
 */
export class Hud {
  private readonly level: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly levelUp: HTMLElement;
  private readonly hurt: HTMLElement;

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

    const bars = document.createElement('div');
    bars.id = 'hud-bars';

    const hp = document.createElement('div');
    hp.id = 'hud-hp';
    this.hpFill = document.createElement('div');
    this.hpFill.id = 'hud-hp-fill';
    hp.appendChild(this.hpFill);
    bars.appendChild(hp);

    const bar = document.createElement('div');
    bar.id = 'hud-xp';
    this.xpFill = document.createElement('div');
    this.xpFill.id = 'hud-xp-fill';
    bar.appendChild(this.xpFill);
    bars.appendChild(bar);
    top.appendChild(bars);

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
    this.hint.textContent = '왼쪽으로 이동 · 오른쪽으로 조준 · 멈춰 서면 적의 화살에 맞는다';
    host.appendChild(this.hint);

    // 맞았을 때 화면 가장자리가 붉어진다. 작은 화면에서는 위쪽 체력바보다
    // 이쪽이 먼저 눈에 들어온다 — 시선은 발밑(적과 화살)에 가 있기 때문이다.
    this.hurt = document.createElement('div');
    this.hurt.id = 'hurt';
    host.appendChild(this.hurt);
  }

  update(world: World, fps: number): void {
    const seconds = world.elapsed;
    // 화면 시간이 아니라 시뮬레이션 시간으로 잰다. 탭이 멈추면 게임도 멈춘다.
    const frameSeconds = Math.max(seconds - this.lastElapsed, 0);
    this.lastElapsed = seconds;

    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    this.stats.textContent = `${mm}:${ss.toString().padStart(2, '0')}   처치 ${world.kills}`;
    this.readout.textContent = `${Math.round(fps)}fps ${world.lockedEnemy ? '자동' : '수동'}`;

    const player = world.player;
    const hpRatio = Math.max(player.hp, 0) / player.maxHp;
    this.hpFill.style.transform = `scaleX(${hpRatio.toFixed(4)})`;
    // 체력이 얼마 안 남았으면 바 자체가 뛴다. 숫자를 읽지 않아도 알아야 한다.
    this.hpFill.dataset['low'] = hpRatio <= 0.3 ? '1' : '0';
    // 쓰러지면 시뮬레이션이 멈춰 hitFlash가 그 값 그대로 얼어붙는다. 그대로 두면
    // 결과 화면 내내 화면이 붉게 남아 고장처럼 보인다 — 할 말은 쓰러진 화면이 한다.
    this.hurt.style.opacity = world.defeated ? '0' : (player.hitFlash * 0.72).toFixed(3);

    const progress = world.progress;
    if (progress.level !== this.lastLevel) {
      this.lastLevel = progress.level;
      this.level.textContent = `Lv ${progress.level}`;
      this.levelUpTimer = LEVEL_UP_SECONDS;
      // 애니메이션을 다시 태우려면 클래스를 한 번 떼었다 붙여야 한다.
      this.level.classList.remove('is-up');
      void this.level.offsetWidth;
      this.level.classList.add('is-up');
      // 보통은 3중 1택 카드가 레벨업을 알린다. 카드가 뜨지 않을 때(고를 카드가
      // 다 떨어졌을 때)만 글자로 알린다 — 둘이 겹치면 화면이 시끄럽다.
      if (!world.offer) this.levelUp.dataset.show = '1';
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
