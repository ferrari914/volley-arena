import { clamp, length, type Vec2 } from '../core/math';
import type { Obstacle } from '../entities/types';
import { pushOutOfObstacles } from './obstacles';

/**
 * 몸 하나를 설 수 있는 자리에 앉힌다. 아레나 밖으로는 나가지 못하게 원 안쪽으로
 * 밀어 넣고(벽을 따라 미끄러지도록 각도는 유지하고 반지름만 자른다), 기둥
 * (DESIGN 10번)에서도 밀어낸다 — 밖으로 밀어내므로 비스듬히 닿으면 미끄러져 지나간다.
 *
 * **벽을 먼저 자르고 기둥을 나중에 민다**: 순서를 뒤집으면 벽에 붙어 선 기둥이
 * 몸을 아레나 밖으로 밀어낼 수 있다.
 *
 * **몸을 옮기는 곳은 전부 이 함수를 지난다** — 걸어가는 플레이어(`movePlayer`)도,
 * 걸어오는 적(`systems/enemyAi.ts`의 `moveBy`)도, 화살에 밀린 적
 * (`systems/combat.ts`의 밀어내기 카드)도. 자리를 자르는 규칙이 갈라지면
 * "여기는 벽을 뚫는다"는 고장이 옮기는 길마다 따로 생긴다.
 */
export function settleBody(
  pos: Vec2,
  arenaRadius: number,
  bodyRadius: number,
  obstacles: readonly Obstacle[] = [],
): Vec2 {
  const limit = Math.max(arenaRadius - bodyRadius, 0);
  const dist = length(pos);
  const inArena =
    dist <= limit
      ? pos
      : dist < 1e-6
        ? { x: 0, y: 0 }
        : { x: (pos.x * limit) / dist, y: (pos.y * limit) / dist };
  return pushOutOfObstacles(inArena, bodyRadius, obstacles);
}

/**
 * 겨눈 쪽에서 물러나는 동안 이동 속도에 곱해지는 값(DESIGN 8번 · 뒷걸음).
 * 정확히 뒤로 가면 `1 + backstep`, 옆으로 가면 1, 앞으로 가면 1이다.
 *
 * **각으로 잰다. 뒤/앞 두 칸으로 자르지 않는다.** 90도에서 딱 끊으면 옆으로 걷는
 * 사람이 스틱을 한 칸 기울일 때마다 속도가 튀어, 화면에서는 그것이 "가끔 미끄러진다"로
 * 보인다. 코사인으로 재면 뒤로 돌아설수록 몫이 차오르므로 튀는 자리가 없다.
 *
 * **기준은 적이 아니라 `facing`(겨눈 쪽)이다.** 화면에서 읽을 수 있는 것은 몸이
 * 향한 쪽뿐이고, 그래야 오른쪽 스틱으로 다른 곳을 겨눈 사람에게는 이 카드가
 * 듣지 않는다 — **등을 보이고 달아나면 아무것도 해 주지 않는다**가 이 카드의 요구다.
 *
 * 스틱을 살짝만 기울인 프레임에도 방향은 같으므로 **길이를 빼고 방향만 본다**.
 * 걷는 속도 자체는 스틱 길이에 그대로 실린다(`movePlayer`).
 */
export function backstepBoost(move: Vec2, facing: number, backstep: number): number {
  if (backstep <= 0) return 1;
  const len = length(move);
  if (len < 1e-6) return 1;
  const toward = (move.x * Math.cos(facing) + move.y * Math.sin(facing)) / len;
  return 1 + backstep * Math.max(0, -toward);
}

/** 이동 입력을 받아 새 위치를 돌려준다. 자리를 자르는 것은 `settleBody`가 한다. */
export function movePlayer(
  pos: Vec2,
  move: Vec2,
  dt: number,
  speed: number,
  arenaRadius: number,
  bodyRadius: number,
  obstacles: readonly Obstacle[] = [],
): Vec2 {
  const next = { x: pos.x + move.x * speed * dt, y: pos.y + move.y * speed * dt };
  return settleBody(next, arenaRadius, bodyRadius, obstacles);
}

/** 스틱 값을 화면 기준에서 월드 XZ 기준으로 바꾼다. 스틱 위(-y)가 월드 앞(-z)이다. */
export function stickToWorld(stick: Vec2): Vec2 {
  return { x: clamp(stick.x, -1, 1), y: clamp(stick.y, -1, 1) };
}
