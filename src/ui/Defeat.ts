import type { World } from '../core/World';

/** 쓰러진 화면에서 나가는 두 갈래 (DESIGN 6번). */
export interface DefeatActions {
  /** 부활(광고): 죽은 그 자리에서 레벨과 카드를 유지한 채 이어서. */
  onRevive: () => void;
  /** 리스폰(무료): 레벨과 카드를 전부 버리고 처음부터. */
  onRestart: () => void;
}

/**
 * 쓰러졌을 때 뜨는 화면 (DESIGN 6번 — 사망 · 리스폰 · 부활).
 *
 * 나가는 길은 둘이고, **둘의 차이는 "지금까지 쌓은 것을 들고 가는가"** 하나다.
 * 그 차이가 버튼 글자만으로 읽혀야 한다 — 죽은 직후에 설명을 읽는 사람은 없다.
 * 그래서 각 버튼 밑에 한 줄씩 결과를 적어 둔다(유지 / 초기화).
 *
 * 이어하기를 위에 둔 이유: 방금까지 쌓아 온 것을 지키는 쪽이 그 순간에 하고 싶은 일이고,
 * 처음부터는 언제든 할 수 있다. 다만 "처음부터"를 흐릿하게 만들지는 않는다 —
 * 광고를 피할 길이 눈에 안 보이면 그건 고른 것이 아니다.
 *
 * 이 화면은 World를 바꾸지 않는다. 버튼은 받은 콜백을 부를 뿐이고,
 * 실제로 판을 되돌리는 일은 main.ts가 한다(부활은 World가, 리스폰은 World 교체가).
 */
export class Defeat {
  private readonly root: HTMLElement;
  private readonly summary: HTMLElement;
  private shown = false;

  constructor(host: HTMLElement, actions: DefeatActions) {
    this.root = document.createElement('div');
    this.root.id = 'defeat';

    const title = document.createElement('div');
    title.id = 'defeat-title';
    title.textContent = '쓰러졌다';
    this.root.appendChild(title);

    this.summary = document.createElement('div');
    this.summary.id = 'defeat-summary';
    this.root.appendChild(this.summary);

    const choices = document.createElement('div');
    choices.id = 'defeat-choices';
    choices.appendChild(
      this.createChoice({
        id: 'defeat-revive',
        kind: 'revive',
        label: '이어하기',
        note: '광고를 보고 그 자리에서 · 레벨과 카드 유지',
        onPick: actions.onRevive,
      }),
    );
    choices.appendChild(
      this.createChoice({
        id: 'defeat-again',
        kind: 'restart',
        label: '처음부터',
        note: '레벨과 카드를 버리고 1레벨부터',
        onPick: actions.onRestart,
      }),
    );
    this.root.appendChild(choices);

    host.appendChild(this.root);
  }

  /**
   * 매 프레임 호출된다. 쓰러진 순간 화면을 채우고, 다시 일어서면 내린다.
   *
   * 상태가 바뀔 때만 DOM을 만진다 — 여기는 초당 60번 불린다.
   */
  sync(world: World): void {
    if (world.defeated === this.shown) return;
    this.shown = world.defeated;

    if (!world.defeated) {
      delete this.root.dataset['show'];
      return;
    }

    const mm = Math.floor(world.elapsed / 60);
    const ss = Math.floor(world.elapsed % 60);
    // 이어하기로 버틴 판은 그 사실까지 적는다. 안 적으면 다음 판의 기록과 나란히 놓았을 때
    // 무엇이 다른 판인지 알 수 없다(결과 화면 — DESIGN 7번 — 이 이 값을 그대로 쓴다).
    const revived = world.revives > 0 ? ` · 이어하기 ${world.revives}회` : '';
    this.summary.textContent =
      `레벨 ${world.progress.level} · 처치 ${world.kills} · ` +
      `${mm}:${ss.toString().padStart(2, '0')} 생존${revived}`;
    this.root.dataset['show'] = '1';
  }

  private createChoice(spec: {
    id: string;
    kind: string;
    label: string;
    note: string;
    onPick: () => void;
  }): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'defeat-choice';

    const button = document.createElement('button');
    button.type = 'button';
    button.id = spec.id;
    button.className = 'defeat-button';
    button.dataset['kind'] = spec.kind;
    button.textContent = spec.label;
    // 손가락이 버튼에 닿은 것을 가상 스틱이 가져가지 않게 한다(스틱은 #app에서 듣는다).
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', spec.onPick);
    wrap.appendChild(button);

    const note = document.createElement('span');
    note.className = 'defeat-note';
    note.textContent = spec.note;
    wrap.appendChild(note);

    return wrap;
  }
}
