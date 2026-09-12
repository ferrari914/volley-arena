import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENEMY } from '../src/data/config';
import {
  CAMERA_FOCUS_BACK,
  CAMERA_OFFSET,
  CAMERA_TILT,
  cameraFocusFor,
  createGameCamera,
  groundExtent,
  placeCamera,
} from '../src/render/camera';
import { bodyScreenHeight, makeProjector } from './support/camera';

/** `npm run qa`가 찍는 두 창. 옆으로 보이는 거리는 화면비의 함수라 둘 다 봐야 한다. */
const MOBILE = 844 / 390;
const DESKTOP = 16 / 9;

describe('쿼터뷰 카메라', () => {
  /**
   * **이 검사가 이 파일의 이유다.** 세션 26~28이 도구 쪽에서 세 번 겪은 일이 전부 같은 종류다 —
   * 재는 자가 화면과 조금씩 다른 카메라를 세워 두고, 그 수치가 화면의 수치인 줄 알고 STATUS에 적혔다.
   * 화면 밖을 재는 자(`tests/support/camera.ts`)는 눈으로 확인할 그림을 남기지 않으므로
   * 어긋나도 아무도 눈치채지 못한다. 그래서 기계가 매 바퀴 견준다.
   */
  it('화면 밖을 재는 자가 화면과 같은 카메라를 세운다', () => {
    for (const aspect of [MOBILE, DESKTOP]) {
      const real = createGameCamera(aspect);
      const rig = makeProjector(aspect);

      // 플레이어가 원점이 아닌 자리에 서 있어야 "따라다니는 방식"까지 견줄 수 있다.
      const player = { x: 4.5, y: -6.25 };
      placeCamera(real, cameraFocusFor(player));
      real.updateMatrixWorld(true);
      rig.place(player);

      const points: readonly [number, number, number][] = [
        [4.5, -6.25, 0],
        [-3, 7, 1.9],
        [18, 12, 1.05],
      ];
      for (const [x, y, h] of points) {
        const expected = new THREE.Vector3(x, h, y).project(real);
        const actual = rig.project(x, y, h);
        expect(actual.nx).toBeCloseTo(expected.x, 10);
        expect(actual.ny).toBeCloseTo(expected.y, 10);
      }
    }
  });

  /**
   * 머리 위 체력바가 카메라를 마주 보는 각도(`models.ts`의 `createHealthBar`)가 이 값에서 나온다.
   * 자리를 옮기면서 기울기를 함께 바꾸면 체력바가 누워 보인다 — 그때 화면을 다시 찍을 것.
   */
  it('기울기는 자리에서 나온다 — 체력바가 쓰는 각도와 한 몸이다', () => {
    expect(CAMERA_TILT).toBeCloseTo(Math.atan2(CAMERA_OFFSET.y, CAMERA_OFFSET.z), 12);
    expect((CAMERA_TILT * 180) / Math.PI).toBeCloseTo(51.1, 1);
  });

  /**
   * **활잡이가 서 있는 띠를 사방에서 덮는다.**
   *
   * 적은 `approachDistance`(12m)보다 멀면 다가오고 `keepDistance`(8m)보다 가까우면 물러난다 —
   * 즉 겨누는 적은 거의 다 8~12m 띠 위에 선다. 이 띠의 어느 쪽이든 화면 밖이면
   * **예고를 볼 수 없는 방향이 생기고, 예고를 못 보면 피할 방법이 없다**
   * (DESIGN "처음 하는 사람이 설명 없이 30초 안에").
   *
   * 세션 29 전까지 뒤쪽이 8.1m뿐이라 띠의 뒤쪽 절반이 화면 밖이었다.
   * 지금은 앞 14.7 · 뒤 12.4 · 옆 16.6m(16:9)다 — **뒤쪽의 여유가 0.4m로 가장 좁으니
   * 카메라를 앞으로 당기거나 보는 점을 앞으로 옮기면 여기가 가장 먼저 깨진다.**
   */
  it('겨누는 적이 서는 띠가 사방으로 화면 안이다', () => {
    for (const aspect of [MOBILE, DESKTOP]) {
      const extent = groundExtent(aspect);
      expect(extent.forward).toBeGreaterThanOrEqual(ENEMY.approachDistance);
      expect(extent.back).toBeGreaterThanOrEqual(ENEMY.approachDistance);
      expect(extent.side).toBeGreaterThanOrEqual(ENEMY.approachDistance);
    }
  });

  /**
   * **카메라를 빼면서 치르는 값에 바닥을 둔다.** 사방을 넓히는 가장 쉬운 방법은 계속 뒤로 빼는 것인데,
   * 그러면 화면 밖 사건은 0%에 가까워지는 대신 모바일에서 적이 점이 된다.
   * 세션 30 실측으로 1.15배는 3.46%까지 내려간다 — 모바일 우선 원칙(DESIGN)에 따라
   * **1.1배(3.60%)에서 멈췄고, 이 선이 그 결정을 붙잡는다.**
   */
  it('모바일에서 몸이 이보다 작아지지 않는다', () => {
    expect(bodyScreenHeight(MOBILE)).toBeGreaterThanOrEqual(3.5);
  });

  /**
   * **보는 점을 뒤로 민 만큼 플레이어가 화면 위로 올라간다.** 그것이 뒤가 보이게 되는 방식이다 —
   * 0이면 플레이어가 화면 한가운데에 서고 뒤쪽은 8m밖에 안 보인다.
   *
   * 위쪽 끝은 상단 HUD가 정한다(체력바·경험치바 — `style.css`의 `#hud-top`은 위에서 10~70px).
   * 모바일 가로(390px)에서 그 아래 끝이 ny ≈ 0.64이므로, 플레이어 가슴이 ny 0.45를 넘으면
   * 조준하는 자기 몸이 HUD에 가린다. 지금 값은 0.33이다.
   */
  it('플레이어는 화면 가운데보다 위에 서되 상단 HUD에는 닿지 않는다', () => {
    expect(CAMERA_FOCUS_BACK).toBeGreaterThan(0);
    const rig = makeProjector(MOBILE);
    rig.place({ x: 0, y: 0 });
    const chest = rig.project(0, 0, 0.85);
    expect(chest.nx).toBeCloseTo(0, 10);
    expect(chest.ny).toBeGreaterThan(0);
    expect(chest.ny).toBeLessThan(0.45);
  });
});
