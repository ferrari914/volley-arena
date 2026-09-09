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
