import * as THREE from 'three';
import {
  CAMERA_FOCUS_BACK,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  CAMERA_OFFSET,
} from '../../src/render/camera';
import type { Vec2 } from '../../src/core/math';

/**
 * **화면 밖을 재는 자.** 세계의 한 점이 화면의 어디에 찍히는지 돌려준다.
 *
 * 후보 카메라를 받는 이유는 하나뿐이다 — **값을 고르려면 지금 값이 아닌 것도 재야 한다**
 * (`tests/perf/camera.perf.ts`의 표). 기본값은 지금 화면의 값(`src/render/camera.ts`)이고,
 * 그 기본값으로 세운 카메라가 화면이 세우는 카메라와 **같은 자리·같은 각도인지**를
 * `tests/camera.test.ts`가 매 바퀴 확인한다. 그 확인이 이 파일의 존재 이유다:
 * 재는 자가 화면과 조금씩 다른 것을 세워 두면 그 수치가 화면의 수치인 줄 알고 STATUS에 적힌다
 * (세션 26~28이 도구 쪽에서 세 번 겪었다).
 */
export interface CameraSpec {
  offset: { x: number; y: number; z: number };
  focusBack: number;
}

export const CURRENT_CAMERA: CameraSpec = {
  offset: CAMERA_OFFSET,
  focusBack: CAMERA_FOCUS_BACK,
};

export interface ScreenPoint {
  /** 화면 좌표(-1~1). 이 범위를 벗어나면 화면 밖이다. */
  nx: number;
  ny: number;
}

export function isOffScreen(p: ScreenPoint): boolean {
  return Math.abs(p.nx) > 1 || Math.abs(p.ny) > 1;
}

/**
 * 한 화면비·한 카메라를 세워 두고 점을 찍어 보는 자.
 *
 * **세우는 것(`place`)과 찍는 것(`project`)이 갈라져 있는 이유**: 쿼터뷰 카메라는
 * 플레이어를 따라다니므로 같은 적이라도 플레이어가 어디 서 있느냐에 따라 화면 안팎이 갈리는데,
 * 한 프레임 안에서는 플레이어가 한 자리다. 카메라를 세우는 것(`lookAt` + 행렬 갱신)이
 * 점 하나 찍는 것보다 훨씬 비싸서, 한 프레임에 적 열 마리와 화살 여남은 발을 찍는 표에서는
 * 이걸 갈라 두지 않으면 재는 데만 몇 분이 든다.
 *
 * (실제 화면은 `Renderer.syncCamera`가 부드럽게 따라붙지만, 여기서는 바로 붙인 자리를 쓴다 —
 * 따라붙는 지연까지 재면 카메라 값이 아니라 지연의 값을 재게 된다.)
 */
export interface Projector {
  /** 플레이어가 여기 서 있는 프레임으로 카메라를 세운다. */
  place(player: Vec2): void;
  /** 바닥 좌표 (x, y)에 높이 `height`로 떠 있는 점이 화면 어디에 찍히는가. */
  project(x: number, y: number, height: number): ScreenPoint;
}

export function makeProjector(aspect: number, spec: CameraSpec = CURRENT_CAMERA): Projector {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
  const focus = new THREE.Vector3();
  const point = new THREE.Vector3();

  return {
    place(player) {
      focus.set(player.x, 0, player.y + spec.focusBack);
      camera.position.set(focus.x + spec.offset.x, spec.offset.y, focus.z + spec.offset.z);
      camera.lookAt(focus);
      camera.updateMatrixWorld(true);
    },
    project(x, y, height) {
      point.set(x, height, y).project(camera);
      return { nx: point.x, ny: point.y };
    },
  };
}

/** 키 1m짜리가 플레이어 자리에서 화면 높이의 몇 %로 찍히는가. 카메라를 뺄 때 치르는 값이다. */
export function bodyScreenHeight(aspect: number, spec: CameraSpec = CURRENT_CAMERA): number {
  const projector = makeProjector(aspect, spec);
  projector.place({ x: 0, y: 0 });
  const foot = projector.project(0, 0, 0);
  const head = projector.project(0, 0, 1);
  return (Math.abs(head.ny - foot.ny) / 2) * 100;
}
