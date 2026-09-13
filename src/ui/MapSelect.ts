import { ARENA } from '../data/config';
import { MAPS, type ArenaMap } from '../data/maps';
import { readLastMap, writeLastMap } from '../data/records';

/**
 * 시작할 때 아레나를 고르는 화면 (DESIGN 10번 — "시작 시 선택").
 *
 * **한 번 누르면 판이 시작된다.** 고르기 → 확인 → 시작으로 나누지 않는다:
 * DESIGN 품질 기준이 "링크를 열고 3초 안에 플레이가 시작될 것"이라, 한 번 더 누르게
 * 하는 화면은 그 3초를 쓰는 값어치를 해야 한다. 맵 둘 중 하나를 고르는 일은 그렇지 않다.
 *
 * **그림을 먼저 보여 준다.** 이름과 한 줄 설명만으로는 무엇이 다른지 알 수 없고,
 * 처음 여는 사람은 두 이름 다 처음 본다. 그래서 맵 데이터(`data/maps.ts`)에서
 * 곧바로 위에서 내려다본 그림을 그린다 — 기둥 여섯이 벽 앞에 둘러선 것이 한눈에 보이고,
 * **맵을 하나 더 넣어도 이 화면은 고칠 것이 없다.**
 *
 * 지난 판에 고른 맵을 미리 짚어 둔다(`readLastMap`). 늘 같은 맵을 하는 사람에게
 * 이 화면은 "누르던 자리를 한 번 더 누르는" 화면이 되어야 한다.
 */
export class MapSelect {
  private readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private picked = false;

  constructor(
    host: HTMLElement,
    private readonly onPick: (map: ArenaMap) => void,
    lastId: string | null = readLastMap(),
  ) {
    this.root = document.createElement('div');
    this.root.id = 'map-select';

    const title = document.createElement('div');
    title.id = 'map-select-title';
    title.textContent = '어디서 싸울까';
    this.root.appendChild(title);

    const list = document.createElement('div');
    list.id = 'map-select-list';
    for (const map of MAPS) list.appendChild(this.createCard(map));
    this.root.appendChild(list);

    const hint = document.createElement('div');
    hint.id = 'map-select-hint';
    hint.textContent = '고르면 바로 시작한다';
    this.root.appendChild(hint);

    host.appendChild(this.root);

    // 지난 판의 맵을 짚어 둔다. 없거나 모르는 이름표면 첫 번째(기본 맵)다.
    const remembered = lastId !== null && this.buttons.has(lastId) ? lastId : (MAPS[0]?.id ?? '');
    this.buttons.get(remembered)?.setAttribute('data-last', '1');
    this.root.dataset['show'] = '1';
  }

  /** 지금 이 화면이 떠 있는가. 떠 있는 동안 게임은 돌지 않는다(`main.ts`). */
  get open(): boolean {
    return !this.picked;
  }

  private createCard(map: ArenaMap): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-card';
    button.dataset['map'] = map.id;
    button.id = `map-card-${map.id}`;

    button.appendChild(createMapThumb(map));

    const name = document.createElement('span');
    name.className = 'map-card-name';
    name.textContent = map.name;
    button.appendChild(name);

    const blurb = document.createElement('span');
    blurb.className = 'map-card-blurb';
    blurb.textContent = map.blurb;
    button.appendChild(blurb);

    // 손가락이 버튼에 닿은 것을 가상 스틱이 가져가지 않게 한다(쓰러진 화면과 같은 이유).
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', () => this.pick(map));

    this.buttons.set(map.id, button);
    return button;
  }

  /**
   * 한 번만 받는다. 두 번 눌리면 판이 두 번 만들어지고 앞의 것이 그대로 새는데,
   * 화면에서는 아무 일도 없어 보인다(빠른 두 번 탭은 모바일에서 흔한 일이다).
   */
  private pick(map: ArenaMap): void {
    if (this.picked) return;
    this.picked = true;
    writeLastMap(map.id);
    delete this.root.dataset['show'];
    this.onPick(map);
  }
}

/**
 * 맵을 위에서 내려다본 그림. **맵 데이터에서 곧바로 그린다** —
 * 그림을 손으로 그려 두면 기둥을 옮긴 날 그림이 조용히 거짓말을 한다.
 *
 * SVG인 이유: 외부 이미지 파일을 쓰지 않고(DESIGN — 에셋 도입 금지), 어떤 화면 배율에도
 * 또렷하며, 아레나 좌표를 그대로 옮겨 담을 수 있다.
 */
function createMapThumb(map: ArenaMap): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const size = 100;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'map-thumb');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');

  const scale = (size / 2 - 3) / ARENA.radius;
  const at = (v: number): number => size / 2 + v * scale;

  const floor = document.createElementNS(ns, 'circle');
  floor.setAttribute('cx', String(size / 2));
  floor.setAttribute('cy', String(size / 2));
  floor.setAttribute('r', String(ARENA.radius * scale));
  floor.setAttribute('class', 'map-thumb-floor');
  svg.appendChild(floor);

  for (const pillar of map.obstacles) {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', at(pillar.x).toFixed(2));
    circle.setAttribute('cy', at(pillar.y).toFixed(2));
    circle.setAttribute('r', (pillar.radius * scale).toFixed(2));
    circle.setAttribute('class', 'map-thumb-pillar');
    svg.appendChild(circle);
  }

  // 한복판의 점은 판이 열릴 때 내가 서는 자리다. 기둥과의 거리가 이 그림의 전부다.
  const start = document.createElementNS(ns, 'circle');
  start.setAttribute('cx', String(size / 2));
  start.setAttribute('cy', String(size / 2));
  start.setAttribute('r', '3.4');
  start.setAttribute('class', 'map-thumb-start');
  svg.appendChild(start);

  return svg;
}
