import type { World } from '../core/World';

/**
 * 쓰러졌을 때 뜨는 화면 (DESIGN 5번의 "사망 처리"까지).
 *
 * **여기서 끝나는 것은 이번 판이지 기능이 아니다.** 리스폰(무료·전부 초기화)과
 * 부활(광고·그 자리에서 이어하기)은 DESIGN 6번의 일이고, 그때 이 화면이
 * 두 갈래 버튼을 갖게 된다. 지금은 한 갈래(처음부터)만 둔다 —
 * 죽은 뒤에 아무 일도 일어나지 않는 화면을 남겨 두지 않기 위해서다.
 *
 * 다시 시작이 페이지를 새로 여는 이유: 렌더러가 화살·코어의 번호로 메시를 짝짓고 있어서,
 * World만 새로 만들면 1번부터 다시 시작하는 번호가 아직 남아 있는 메시와 겹친다.
 * 6번에서 리스폰을 제대로 만들 때 World와 렌더러를 함께 되돌리는 길을 낸다.
 */
export class Defeat {
  private readonly root: HTMLElement;
  private readonly summary: HTMLElement;
  private shown = false;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'defeat';

    const title = document.createElement('div');
    title.id = 'defeat-title';
    title.textContent = '쓰러졌다';
    this.root.appendChild(title);

    this.summary = document.createElement('div');
    this.summary.id = 'defeat-summary';
    this.root.appendChild(this.summary);

    const again = document.createElement('button');
    again.type = 'button';
    again.id = 'defeat-again';
    again.textContent = '다시 시작';
    again.addEventListener('click', () => window.location.reload());
    this.root.appendChild(again);

    host.appendChild(this.root);
  }

  /** 매 프레임 호출된다. 쓰러진 순간 한 번만 화면을 채운다. */
  sync(world: World): void {
    if (!world.defeated || this.shown) return;
    this.shown = true;

    const mm = Math.floor(world.elapsed / 60);
    const ss = Math.floor(world.elapsed % 60);
    this.summary.textContent =
      `레벨 ${world.progress.level} · 처치 ${world.kills} · ` +
      `${mm}:${ss.toString().padStart(2, '0')} 생존`;
    this.root.dataset['show'] = '1';
    document.body.dataset['paused'] = '1';
  }
}
