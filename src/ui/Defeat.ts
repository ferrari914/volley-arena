import type { World } from '../core/World';
import { UPGRADE_CARDS } from '../data/upgrades';
import { submitRun, type RecordOutcome, type RunRecord, type RunResult } from '../data/records';

/** 쓰러진 화면에서 나가는 두 갈래 (DESIGN 6번). */
export interface DefeatActions {
  /** 부활(광고): 죽은 그 자리에서 레벨과 카드를 유지한 채 이어서. */
  onRevive: () => void;
  /** 리스폰(무료): 레벨과 카드를 전부 버리고 처음부터. */
  onRestart: () => void;
}

/** 기록을 제출하는 통로. 기본값은 진짜 localStorage, 테스트는 가짜를 끼운다. */
export type SubmitRun = (run: RunResult) => RecordOutcome;

/** 카드 id → 화면에 보일 이름. 결과 화면이 "무엇으로 강해졌는가"를 적을 때 쓴다. */
const CARD_TITLES = new Map(UPGRADE_CARDS.map((card) => [card.id, card.title]));

/**
 * 쓰러졌을 때 뜨는 결과 화면 (DESIGN 6번 사망·부활 + 7번 결과·기록).
 *
 * **화면을 하나 더 만들지 않고 이 화면을 키웠다.** 3~5분짜리 게임에서 죽은 뒤에
 * 화면을 두 번 넘기게 하면 다음 판까지 가는 길이 그만큼 길어진다. 여기서 이번 판을
 * 확인하고 곧바로 다음 판으로 나간다 — 결과와 출구가 한 화면에 있다.
 *
 * 적는 것은 셋이다.
 *   ① 이번 판 — 도달 레벨 · 처치 수 · 생존 시간 (DESIGN 7번)
 *   ② 최고 기록 — 브라우저에 남는 값. 견줄 것이 없으면 숫자는 그냥 숫자다
 *   ③ 무엇으로 강해졌는가 — 고른 카드. 판마다 다른 유일한 자리다
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
  private readonly runValue: HTMLElement;
  private readonly bestRow: HTMLElement;
  private readonly bestLabel: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly note: HTMLElement;
  private readonly taken: HTMLElement;
  private readonly submit: SubmitRun;
  private shown = false;

  constructor(host: HTMLElement, actions: DefeatActions, submit: SubmitRun = submitRun) {
    this.submit = submit;
    this.root = document.createElement('div');
    this.root.id = 'defeat';

    const title = document.createElement('div');
    title.id = 'defeat-title';
    title.textContent = '쓰러졌다';
    this.root.appendChild(title);

    const summary = document.createElement('div');
    summary.id = 'defeat-summary';
    this.runValue = this.createRow(summary, '이번 판', 'defeat-run', 'run').value;
    const best = this.createRow(summary, '최고 기록', 'defeat-best', 'best');
    this.bestRow = best.row;
    this.bestLabel = best.label;
    this.bestValue = best.value;
    this.root.appendChild(summary);

    // 기록에 얽힌 사정이 있을 때만 한 줄 뜬다(신기록 / 이어한 판 / 저장이 막힌 브라우저).
    this.note = document.createElement('div');
    this.note.id = 'defeat-record-note';
    this.root.appendChild(this.note);

    this.taken = document.createElement('div');
    this.taken.id = 'defeat-taken';
    this.root.appendChild(this.taken);

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
   * **기록 제출도 이 전환에서 딱 한 번 일어난다.** 매 프레임 제출하면
   * localStorage에 초당 60번 쓰게 되고, 이어하기로 다시 죽으면 그 판은 또 한 번
   * (이번에는 이어한 판으로) 제출된다 — 그게 맞다. 한 판의 끝이 그때마다 새로 온다.
   */
  sync(world: World): void {
    if (world.defeated === this.shown) return;
    this.shown = world.defeated;

    if (!world.defeated) {
      delete this.root.dataset['show'];
      return;
    }

    const run: RunResult = {
      level: world.progress.level,
      kills: world.kills,
      time: world.elapsed,
      revives: world.revives,
    };
    this.paint(run, this.submit(run), world.takenUpgrades);
    this.root.dataset['show'] = '1';
  }

  /**
   * 화면에 값을 채운다. 기록 규칙의 판단은 이미 끝나 있고 여기서는 옮겨 적기만 한다.
   *
   * 둘째 줄은 경우에 따라 다른 것을 가리킨다. **기록을 갈아치웠으면 이번 판이 곧 최고
   * 기록이므로, 같은 숫자를 두 번 적는 대신 방금 넘어선 "지난 기록"을 보여 준다** —
   * 얼마나 나아졌는지가 그 자리에서 읽혀야 기록이 다음 판을 부른다.
   * 넘어설 기록이 없었던 첫 판에서는 그 줄을 아예 내린다(적을 것이 없다).
   */
  private paint(run: RunResult, outcome: RecordOutcome, taken: readonly string[]): void {
    this.runValue.textContent = formatRecord(run);
    this.runValue.dataset['fresh'] = outcome.isNew ? '1' : '0';

    const previous = outcome.isNew ? outcome.previous : outcome.best;
    this.bestLabel.textContent = outcome.isNew ? '지난 기록' : '최고 기록';
    this.bestValue.textContent = previous ? formatRecord(previous) : '아직 없다';
    this.bestRow.dataset['show'] = outcome.isNew && !previous ? '0' : '1';

    const { text, kind } = recordNote(run, outcome);
    this.note.textContent = text;
    this.note.dataset['kind'] = kind;

    const summary = formatUpgrades(taken);
    this.taken.textContent = summary;
    // 카드를 한 장도 못 고르고 죽은 판(1레벨 사망)에서는 빈 줄을 남기지 않는다.
    this.taken.dataset['show'] = summary ? '1' : '0';
  }

  private createRow(
    host: HTMLElement,
    label: string,
    id: string,
    kind: string,
  ): { row: HTMLElement; label: HTMLElement; value: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'defeat-row';
    row.dataset['kind'] = kind;
    row.dataset['show'] = '1';

    const name = document.createElement('span');
    name.className = 'defeat-row-label';
    name.textContent = label;
    row.appendChild(name);

    const value = document.createElement('span');
    value.className = 'defeat-row-value';
    value.id = id;
    row.appendChild(value);

    host.appendChild(row);
    return { row, label: name, value };
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

/**
 * 기록 줄 밑에 붙는 한 줄. 할 말이 없으면 빈 문자열이다.
 *
 * 순서가 곧 우선순위다: 이어한 판이라는 사실이 가장 먼저다. 그걸 안 적으면
 * "왜 내 기록이 안 올라갔지"가 되고, 그건 저장이 고장 난 것과 구별되지 않는다.
 */
function recordNote(run: RunResult, outcome: RecordOutcome): { text: string; kind: string } {
  if (!outcome.ranked) {
    return { text: `이어하기 ${run.revives}회 — 이어한 판은 최고 기록에 남지 않는다`, kind: 'note' };
  }
  if (outcome.isNew && !outcome.saved) {
    return { text: `${newRecordLabel(outcome)} (이 브라우저에는 저장되지 않는다)`, kind: 'warn' };
  }
  if (outcome.isNew) return { text: newRecordLabel(outcome), kind: 'new' };
  return { text: '', kind: 'none' };
}

/** 넘어설 기록이 없던 첫 판에 "새 최고 기록"은 어색하다. 그 판은 기록의 시작이다. */
function newRecordLabel(outcome: RecordOutcome): string {
  return outcome.previous ? '새 최고 기록!' : '첫 기록을 남겼다';
}

/** `레벨 5 · 처치 21 · 0:39 생존`. 이번 판과 최고 기록이 같은 모양이어야 눈으로 견줄 수 있다. */
function formatRecord(record: RunRecord): string {
  const mm = Math.floor(record.time / 60);
  const ss = Math.floor(record.time % 60);
  return (
    `레벨 ${record.level} · 처치 ${record.kills} · ` +
    `${mm}:${ss.toString().padStart(2, '0')} 생존`
  );
}

/**
 * 고른 카드를 `연사 ×3 · 질주 ×2` 로 줄인다. 고른 순서를 지키되 같은 카드는 한 번만 적는다 —
 * 여덟 장까지 쌓이는 카드가 있어서 그대로 늘어놓으면 한 줄을 넘긴다.
 */
function formatUpgrades(taken: readonly string[]): string {
  if (taken.length === 0) return '';
  const counts = new Map<string, number>();
  for (const id of taken) counts.set(id, (counts.get(id) ?? 0) + 1);
  const parts: string[] = [];
  for (const [id, count] of counts) {
    const title = CARD_TITLES.get(id) ?? id;
    parts.push(count > 1 ? `${title} ×${count}` : title);
  }
  return parts.join(' · ');
}
