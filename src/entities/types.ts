import type { Vec2 } from '../core/math';

export interface Player {
  pos: Vec2;
  /** 바라보는 각도(rad). 방향 벡터는 (cos, sin) = (x, z). */
  facing: number;
  /** 다음 발사까지 남은 시간(s). */
  fireCooldown: number;
  hp: number;
  maxHp: number;
  /** 남은 무적 시간(s). 0보다 크면 적의 화살이 그냥 지나간다. */
  invulnerable: number;
  /** 피격 연출용. 1에서 0으로 줄어든다. */
  hitFlash: number;
}

/**
 * 화살은 누가 쐈는지를 들고 다닌다. 이것이 없으면 적의 화살이 적을 맞히고
 * 플레이어의 화살이 플레이어를 맞힌다 — 5번에서 가장 중요한 한 줄이다.
 */
export type ArrowOwner = 'player' | 'enemy';

export interface Arrow {
  /** 렌더러가 메시를 짝지을 때 쓰는 고유 번호. */
  id: number;
  owner: ArrowOwner;
  pos: Vec2;
  /** 이동 속도 벡터(m/s). */
  vel: Vec2;
  /** 맞았을 때 깎는 체력. */
  damage: number;
  age: number;
  /**
   * 이 시간이 지나면 사라진다(s). 화살마다 들고 있는 이유:
   * 적의 화살은 느려서 더 오래 날아야 하고, 주인별 표를 다시 찾아보지 않게 한다.
   */
  lifetime: number;
  /**
   * 앞으로 몇 명을 더 뚫고 지나갈 수 있는가(DESIGN 8번 · 관통).
   * 0이면 처음 맞히는 순간 사라진다 — 지금까지의 화살이 전부 그랬다.
   */
  pierce: number;
  /**
   * 관통을 다 쓴 뒤 몇 번 더 방향을 꺾어 다음 적에게 갈 수 있는가(DESIGN 8번 · 튕김).
   * 0이면 관통이 끝나는 자리에서 사라진다.
   */
  bounce: number;
  /**
   * 이미 맞힌 적의 id. **관통·튕김을 가진 화살만 쓰므로 필요해질 때 만든다**(대개는 없다).
   * 없으면 같은 적을 여러 프레임에 걸쳐 다시 맞힌다 — 한 프레임에 나아가는 거리(≈0.57m)가
   * 적 판정 지름(1.72m)보다 짧아서, 몸을 빠져나가는 동안 계속 겹쳐 있기 때문이다.
   *
   * **튕길 때는 직전에 맞힌 놈만 남기고 지운다.** 관통은 지나온 모두를 계속 기억해야
   * 하지만, 튕김은 두 놈 사이를 오가는 것이 그림이라 전부 기억하면 갈 곳이 없어진다.
   */
  hitIds?: number[];
  alive: boolean;
}

/**
 * 적의 종류 (DESIGN 9번).
 * - `archer` — 거리를 지키며 화살을 쏜다(DESIGN 5번의 그 적).
 * - `charger` — 거리를 지우며 몸으로 부딪는다. 화살을 쏘지 않는다.
 *
 * 종류마다 다른 수치는 `data/config.ts`의 `ENEMY`·`CHARGER`에 있고,
 * 행동이 갈리는 곳은 `systems/enemyAi.ts` 한 곳뿐이다.
 */
export type EnemyKind = 'archer' | 'charger';

/** 적 봇 (DESIGN 5번). 플레이어를 쫓아와 겨누고 쏜다. */
export interface Enemy {
  kind: EnemyKind;
  /** 렌더러가 메시를 짝지을 때 쓰는 고유 번호. 옆으로 도는 방향도 여기서 갈린다. */
  id: number;
  /** 쓰러진 뒤 같은 자리에 다시 세우기 위해 기억해 둔다. */
  home: Vec2;
  pos: Vec2;
  /** 바라보는 각도(rad). 화살은 이 방향으로 나간다. */
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  /** 피격 연출용. 1에서 0으로 줄어든다. */
  hitFlash: number;
  /**
   * 겨누는(돌진형은 웅크리는) 중이면 남은 시간(s). 0보다 크면 멈춰 서 있고,
   * 0이 되는 순간 저지른다 — 활잡이는 화살을 놓고, 돌진형은 몸을 던진다.
   * 두 종류가 이 타이머 하나를 함께 쓰는 덕분에 "멈춰 선 적은 곧 무언가 한다"는
   * 예고의 규칙이 종류를 가리지 않고 같다.
   */
  aimTimer: number;
  /** 다음으로 겨눌(웅크릴) 수 있을 때까지 남은 시간(s). */
  fireCooldown: number;
  /**
   * 돌진이 남은 시간(s). **돌진형만 쓴다**(활잡이는 늘 0).
   * 0보다 큰 동안에는 방향을 바꾸지 않고 `facing` 쪽으로만 달린다 —
   * 그래서 옆으로 비킨 플레이어를 따라 꺾지 못한다. 이것이 피할 여지다.
   */
  dashTimer: number;
}

export function createPlayer(maxHp: number): Player {
  return {
    pos: { x: 0, y: 0 },
    facing: 0,
    fireCooldown: 0,
    hp: maxHp,
    maxHp,
    invulnerable: 0,
    hitFlash: 0,
  };
}

export function createEnemy(
  id: number,
  x: number,
  y: number,
  maxHp: number,
  kind: EnemyKind = 'archer',
): Enemy {
  return {
    id,
    kind,
    home: { x, y },
    pos: { x, y },
    // 처음부터 아레나 가운데(플레이어의 시작 자리)를 본다.
    facing: Math.atan2(-y, -x),
    hp: maxHp,
    maxHp,
    alive: true,
    respawnTimer: 0,
    hitFlash: 0,
    aimTimer: 0,
    fireCooldown: 0,
    dashTimer: 0,
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
  /**
   * 한 번 쏠 때 나가는 화살 수(DESIGN 8번 · 다중 발사).
   * **개수라서 이것만은 곱셈이 아니라 덧셈으로 는다** — 1.5발은 없다.
   */
  arrowCount: number;
  /**
   * 화살 한 발이 추가로 뚫고 지나가는 적의 수(DESIGN 8번 · 관통).
   * **이것도 개수라서 덧셈으로 는다.** 0이면 맞은 자리에서 멈춘다.
   */
  pierce: number;
  /**
   * 화살 한 발이 다음 적에게 꺾여 갈 수 있는 횟수(DESIGN 8번 · 튕김).
   * **이것도 개수라서 덧셈으로 는다.** 관통이 "그대로 더 간다"라면 튕김은 "돌아서 더 간다".
   */
  bounce: number;
}

/**
 * 레벨업 때 제시하는 카드 한 장. 내용은 `data/upgrades.ts`가 데이터로 갖는다.
 * 효과를 함수가 아니라 "무엇에 얼마를 곱하는가"로 적어 두는 이유:
 * 데이터에 코드가 섞이면 카드를 추가할 때마다 규칙을 새로 읽어야 한다.
 */
/**
 * 카드가 하는 일의 갈래.
 *
 * - `power` — 적을 더 빨리 지운다(연사·다중 발사·관통·튕김).
 * - `support` — 그 밖의 모든 것(이동·수집·경험치·회복).
 *
 * **이 갈래는 화면에 나오지 않는다.** 한 번에 보여 주는 `support` 장수를 막는 데만 쓴다
 * (`rollUpgradeChoices`의 `maxSupport`). 세 장이 모두 보조면 이번 레벨업에 화력을 고를
 * 기회 자체가 없고, 그러면 화력을 기를지 말지를 고르는 사람이 아니라 뽑기가 정한다.
 */
export type UpgradeRole = 'power' | 'support';

export interface UpgradeCard {
  id: string;
  title: string;
  /** 카드에 적히는 한 줄. 무엇이 얼마나 좋아지는지 수치로 적는다. */
  detail: string;
  /** 화력인가 보조인가. 새 카드를 만들 때 반드시 정해야 한다 — 기본값을 두지 않는 이유다. */
  role: UpgradeRole;
  /** 같은 카드를 최대 몇 번까지 고를 수 있는가. */
  maxStacks: number;
  /** 카드 색. 화면에서 서로 구별되게 한다. */
  accent: string;
  /** 고를 때마다 곱해지는 값. 적히지 않은 값은 그대로 둔다. */
  multiply?: Partial<Record<keyof PlayerStats, number>>;
  /**
   * 고를 때마다 더해지는 값. **개수처럼 곱셈이 뜻을 잃는 값에만 쓴다**(화살 수).
   * 비율(속도·간격·배율)에는 쓰지 않는다 — 덧셈은 여러 장 겹쳤을 때 값이 0 밑으로
   * 내려가거나 밸런스가 한 번에 무너진다. 그 이유는 `data/upgrades.ts`에 적어 두었다.
   */
  add?: Partial<Record<keyof PlayerStats, number>>;
  /**
   * 고르는 순간 되돌리는 체력. 최대 체력에 대한 비율이다(0.2 = 최대 체력의 20%).
   *
   * **이것만 `PlayerStats`를 지나지 않고 몸에 곧바로 닿는다.** 다른 카드는 전부
   * "앞으로 얼마나 세지는가"를 바꾸지만, 회복은 "지금 얼마나 남았는가"를 바꾼다 —
   * 능력치에 적을 자리가 없다. 왜 초당 회복이 아니라 한 번의 회복인지는
   * `data/upgrades.ts`에 재 본 수치와 함께 적어 두었다.
   */
  heal?: number;
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
