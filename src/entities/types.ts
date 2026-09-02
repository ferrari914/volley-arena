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
