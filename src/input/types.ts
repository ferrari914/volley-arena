import type { Vec2 } from '../core/math';

export interface InputState {
  /** 이동 입력. 길이 0~1. */
  move: Vec2;
  /** 수동 조준 방향(정규화 전). 손을 대지 않았으면 null. */
  aim: Vec2 | null;
}

/** 조준을 화면 좌표에서 월드 좌표로 옮기려면 카메라가 필요하다. 그건 렌더러가 준다. */
export interface InputContext {
  playerPos: Vec2;
  /** 화면의 한 점을 바닥면(y=0) 위의 좌표로. 바닥을 벗어나면 null. */
  screenToGround(clientX: number, clientY: number): Vec2 | null;
}

export interface InputSource {
  read(context: InputContext): InputState;
  dispose(): void;
}

export const IDLE_INPUT: InputState = { move: { x: 0, y: 0 }, aim: null };
