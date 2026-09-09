import type { UpgradeOffer } from '../entities/types';

/**
 * 레벨업 3중 1택 카드 (DESIGN 4번).
 *
 * 카드가 떠 있는 동안 게임은 멈춰 있다(멈춤 자체는 `World`가 지킨다).
 * 화면은 계속 그려지므로 뒤에서 아레나가 보이고, 그 위에 카드가 얹힌다.
 *
 * 고르는 방법은 두 가지다 — 손가락으로 카드를 누르거나, 키보드 1·2·3.
 * 처음부터 둘 다 만든다(DESIGN A-1: 나중에 얹으면 화면 구성을 다시 짜야 한다).
 */
export class UpgradeCards {
  private readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private current: UpgradeOffer | null = null;

  constructor(
    host: HTMLElement,
    private readonly onPick: (id: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'upgrade';

    this.head = document.createElement('div');
    this.head.id = 'upgrade-head';
    this.root.appendChild(this.head);

    this.list = document.createElement('div');
    this.list.id = 'upgrade-list';
    this.root.appendChild(this.list);

    host.appendChild(this.root);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** 매 프레임 호출된다. 내용이 바뀔 때만 DOM을 다시 만든다. */
  sync(offer: UpgradeOffer | null): void {
    if (offer === this.current) return;
    this.current = offer;

    if (!offer) {
      delete this.root.dataset['show'];
      delete document.body.dataset['paused'];
      this.list.replaceChildren();
      return;
    }

    const remaining = offer.remaining > 1 ? ` · 선택 ${offer.remaining}회 남음` : '';
    this.head.textContent = `레벨 ${offer.level} · 하나를 고르세요${remaining}`;

    this.list.replaceChildren(
      ...offer.choices.map((choice, index) => this.createCard(choice, index)),
    );
    this.root.dataset['show'] = '1';
    // 남은 선택 횟수를 화면 밖(검사)에서도 읽을 수 있게 적어 둔다.
    this.root.dataset['remaining'] = String(offer.remaining);
    // 카드를 고르는 동안 가상 스틱을 흐리게 한다. 지금 누를 것은 카드다.
    document.body.dataset['paused'] = '1';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  private createCard(
    choice: UpgradeOffer['choices'][number],
    index: number,
  ): HTMLButtonElement {
    const { card, stacks } = choice;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'up-card';
    button.style.setProperty('--accent', card.accent);
    // 카드가 나타나는 순서를 조금씩 늦춘다. 세 장이 동시에 튀어나오면 눈이 어디를 볼지 모른다.
    button.style.animationDelay = `${index * 55}ms`;

    const mark = document.createElement('span');
    mark.className = 'up-card__mark';
    button.appendChild(mark);

    const key = document.createElement('span');
    key.className = 'up-card__key';
    key.textContent = String(index + 1);
    button.appendChild(key);

    const title = document.createElement('span');
    title.className = 'up-card__title';
    title.textContent = card.title;
    button.appendChild(title);

    const detail = document.createElement('span');
    detail.className = 'up-card__detail';
    detail.textContent = card.detail;
    button.appendChild(detail);

    // 한 번이라도 고른 카드에만 눈금을 붙인다. 처음 보는 카드에 빈 눈금 여덟 칸을 그려 두면
    // 그냥 장식처럼 읽혀 카드가 시끄러워지기만 한다(스크린샷에서 확인했다).
    if (stacks > 0) {
      const pips = document.createElement('span');
      pips.className = 'up-card__pips';
      for (let i = 0; i < card.maxStacks; i += 1) {
        const pip = document.createElement('i');
        if (i < stacks) pip.dataset['on'] = '1';
        pips.appendChild(pip);
      }
      button.appendChild(pips);
    }

    // 손가락이 카드에 닿은 것을 가상 스틱이 가져가지 않게 한다(스틱은 #app에서 듣는다).
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    // 누르는 것은 click이다 — 카드가 뜨기 전부터 눌려 있던 손가락으로는 골라지지 않는다.
    button.addEventListener('click', () => this.onPick(card.id));
    return button;
  }

  /** 데스크톱: 1·2·3으로 고른다. 마우스를 옮기지 않고 고를 수 있어야 빠르다. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.current) return;
    const index = Number(event.key) - 1;
    const choice = this.current.choices[index];
    if (!choice) return;
    event.preventDefault();
    this.onPick(choice.card.id);
  };
}
