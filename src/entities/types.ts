import type { Vec2 } from '../core/math';

export interface Player {
  pos: Vec2;
  /** 바라보는 각도(rad). 방향 벡터는 (cos, sin) = (x, z). */
  facing: number;
  /** 다음 발사까지 남은 시간(s). */
  fireCooldown: number;
}

export interface Arrow {
  /** 렌더러가 메시를 짝지을 때 쓰는 고유 번호. */
  id: number;
  pos: Vec2;
  /** 이동 속도 벡터(m/s). */
  vel: Vec2;
  age: number;
  alive: boolean;
}

/** 자동 조준이 잡는 대상. 5번(적 봇)에서 실제 적으로 교체된다. */
export interface Target {
  /** 맞은 뒤 같은 자리에 다시 세우기 위해 기억해 둔다. */
  home: Vec2;
  pos: Vec2;
  alive: boolean;
  respawnTimer: number;
  /** 피격 연출용. 1에서 0으로 줄어든다. */
  hitFlash: number;
}

export function createPlayer(): Player {
  return { pos: { x: 0, y: 0 }, facing: 0, fireCooldown: 0 };
}

export function createTarget(x: number, y: number): Target {
  return {
    home: { x, y },
    pos: { x, y },
    alive: true,
    respawnTimer: 0,
    hitFlash: 0,
  };
}

/** 경험치 코어가 어디서 나왔는지. 밸런스를 재는 쪽(테스트·HUD)이 둘을 구분한다. */
export type CoreOrigin = 'ambient' | 'drop';

export interface XpCore {
  /** 렌더러가 메시를 짝지을 때 쓰는 고유 번호. */
  id: number;
  pos: Vec2;
  /** 먹었을 때 오르는 경험치. */
  value: number;
  origin: CoreOrigin;
  /** 남은 수명(s). Infinity면 스스로 사라지지 않는다(맵에 놓인 코어). */
  ttl: number;
  /** 생긴 뒤 지난 시간(s). 튀어나오는 연출에 쓴다. */
  age: number;
  alive: boolean;
}

/** 레벨과 경험치. 4번(3중 1택)이 레벨업 시점을 여기서 읽어 간다. */
export interface Progress {
  level: number;
  /** 지금 레벨에서 모은 경험치. */
  xp: number;
  /** 다음 레벨까지 필요한 양. 최대 레벨이면 Infinity. */
  xpToNext: number;
  /** 판 전체에서 모은 총량. 결과 화면(7번)이 쓴다. */
  totalXp: number;
}

export function createXpCore(
  id: number,
  pos: Vec2,
  value: number,
  origin: CoreOrigin,
  ttl: number,
): XpCore {
  return { id, pos: { x: pos.x, y: pos.y }, value, origin, ttl, age: 0, alive: true };
}

/**
 * 업그레이드가 바꾸는 값들. 카드는 여기에 곱해진다(DESIGN 4번).
 *
 * 시작값은 `data/config.ts`에서 온다. World가 이 묶음 하나만 들고 있고
 * 이동·발사·코어가 전부 여기를 보므로, 새 카드를 붙일 때 고칠 자리는 한 곳이다.
 */
export interface PlayerStats {
  /** 발사 간격(s). 작을수록 빠르다. */
  fireCooldown: number;
  /** 이동 속도(m/s). */
  moveSpeed: number;
  /** 코어가 끌려오기 시작하는 거리(m). */
  magnetRadius: number;
  /** 코어에서 얻는 경험치 배율. */
  xpMultiplier: number;
}

/**
 * 레벨업 때 제시하는 카드 한 장. 내용은 `data/upgrades.ts`가 데이터로 갖는다.
 * 효과를 함수가 아니라 "무엇에 얼마를 곱하는가"로 적어 두는 이유:
 * 데이터에 코드가 섞이면 카드를 추가할 때마다 규칙을 새로 읽어야 한다.
 */
export interface UpgradeCard {
  id: string;
  title: string;
  /** 카드에 적히는 한 줄. 무엇이 얼마나 좋아지는지 수치로 적는다. */
  detail: string;
  /** 같은 카드를 최대 몇 번까지 고를 수 있는가. */
  maxStacks: number;
  /** 카드 색. 화면에서 서로 구별되게 한다. */
  accent: string;
  /** 고를 때마다 곱해지는 값. 적히지 않은 값은 그대로 둔다. */
  multiply: Partial<Record<keyof PlayerStats, number>>;
}

/** 카드 한 장과, 그 카드를 지금까지 몇 번 골랐는지. */
export interface UpgradeChoice {
  card: UpgradeCard;
  stacks: number;
}

/** 화면에 떠 있는 3중 1택. 이것이 null이 아니면 게임은 멈춘다. */
export interface UpgradeOffer {
  /** 이 선택을 부른 레벨. 카드 머리글에 쓴다. */
  level: number;
  /** 이번 것을 포함해 남은 선택 횟수. 한 스텝에 두 레벨이 오르면 2가 된다. */
  remaining: number;
  choices: readonly UpgradeChoice[];
}
