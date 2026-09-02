/**
 * 게임 수치는 전부 여기 모은다.
 * 밸런스를 만질 때 코드를 뒤지지 않아도 되게 한다.
 */
export const ARENA = {
  /** 아레나 반지름(m). 플레이어는 이 안쪽에서만 움직인다. */
  radius: 26,
  /** 바닥 격자 한 칸 크기(m). */
  gridStep: 4,
} as const;

export const PLAYER = {
  radius: 0.55,
  height: 1.7,
  /** 이동 속도(m/s). */
  speed: 7.2,
  /** 몸이 조준 방향으로 도는 속도(rad/s). 즉시 돌면 시선이 튄다. */
  turnRate: 14,
} as const;

export const ARROW = {
  speed: 34,
  radius: 0.16,
  /** 생존 시간(s). 벽 밖으로 나가기 전에도 이 시간이 지나면 사라진다. */
  lifetime: 1.6,
  /** 발사 간격(s). */
  cooldown: 0.38,
  /** 활 시위에서 화살이 생기는 앞쪽 거리(m). */
  muzzleOffset: 0.9,
  /** 화살이 날아가는 높이(m). */
  height: 1.05,
} as const;

export const AIM = {
  /** 자동 조준이 적을 잡는 최대 거리(m). */
  autoRange: 22,
  /**
   * 수동 조준 입력이 끊긴 뒤 자동 조준으로 돌아가기까지의 시간(s).
   * 0이면 손가락을 떼는 순간 방향이 홱 돌아가서 조준한 느낌이 사라진다.
   */
  manualHold: 0.45,
  /** 스틱 데드존. */
  deadzone: 0.18,
} as const;

/** 자동 조준 대상. 5번(적 봇)에서 이 자리를 실제 적이 대신한다. */
export const TARGET = {
  radius: 0.7,
  height: 1.9,
  /** 맞은 뒤 다시 나타나기까지의 시간(s). */
  respawnDelay: 1.4,
} as const;
