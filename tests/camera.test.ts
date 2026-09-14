import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARROW, CHARGER, ENEMY, SHIELD, VIEW } from '../src/data/config';
import { World } from '../src/core/World';
import {
  CAMERA_FOCUS_BACK,
  CAMERA_OFFSET,
  CAMERA_TILT,
  cameraFocusFor,
  createGameCamera,
  groundExtent,
  placeCamera,
} from '../src/render/camera';
import { bodyScreenHeight, isOffScreen, makeProjector } from './support/camera';
import { play, preferPower, walkToNearestCore } from './support/match';

/** `npm run qa`가 찍는 두 창. 옆으로 보이는 거리는 화면비의 함수라 둘 다 봐야 한다. */
const MOBILE = 844 / 390;
const DESKTOP = 16 / 9;

/**
 * 적의 몸이 차지하는 상자의 여덟 귀퉁이. **가운데 한 줄(발·머리)만 보면 옆으로 잘리는
 * 것을 놓친다** — `tests/perf/camera.perf.ts`가 쓰는 것과 같은 상자다.
 */
const BODY_CORNERS: readonly [number, number, number][] = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sy) =>
    [0, ENEMY.height].map((h): [number, number, number] => [sx * ENEMY.radius, sy * ENEMY.radius, h]),
  ),
);

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
   * 즉 **다가와 서는** 적은 거의 다 8~12m 띠 위에 선다.
   *
   * **세션 50이 여기에 한 줄을 보탰다**: 그 띠는 서는 띠이지 겨누는 띠가 아니었다.
   * 활잡이는 `fireRange`(15m)에 들어오는 순간부터 겨누므로 겨눔의 43%가 14~16m에서
   * 일어났고, 뒤로는 12.4m까지만 보이므로 그 몫이 화면 밖이었다. 지금은 적이
   * `VIEW` 안에서만 겨누기를 시작한다(아래 '겨눔의 창') — 이 검사는 그 창이 딛고 선
   * 바닥이다. 여기가 깨지면 창도 함께 무너진다. 이 띠의 어느 쪽이든 화면 밖이면
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

/**
 * **적이 겨누기를 시작해도 되는 창**(`data/config.ts`의 `VIEW`).
 *
 * 게임이 화면을 아는 자리는 그 값 하나뿐이고, 그 값이 화면과 어긋나면 **아무도 눈치채지
 * 못한다** — 어긋난 만큼 화면 밖에서 겨누는 적이 생길 뿐 콘솔에도 검사에도 아무 일이
 * 없다(세션 49가 정확히 그렇게 카메라 수치를 잃었다). 그래서 기계가 매 바퀴 견준다.
 */
describe('겨눔의 창 — 게임이 아는 화면과 진짜 화면', () => {
  /**
   * **창은 화면보다 넓을 수 없다.** 넓으면 그 차이만큼 적이 화면 밖에서 겨눈다.
   * 카메라를 앞으로 당기거나 보는 점을 앞으로 옮기면 여기가 먼저 걸린다.
   */
  it('창이 화면 안에 있다', () => {
    for (const aspect of [MOBILE, DESKTOP]) {
      const extent = groundExtent(aspect);
      expect(extent.forward).toBeGreaterThanOrEqual(VIEW.forward);
      expect(extent.back).toBeGreaterThanOrEqual(VIEW.back);
    }
  });

  /**
   * **창은 다가와 서는 거리보다 넓어야 한다.** 좁으면 뒤에서 온 적이 제자리
   * (`approachDistance` 12m)에 다다르고도 영영 겨누지 못하고 맴돈다 —
   * 화면 안에 서 있는 적이 아무것도 하지 않는 것은 고장으로 읽힌다.
   * 뒤쪽(12.3m)이 사방 중 가장 좁으므로 여기만 보면 된다.
   */
  it('창이 적이 다가와 서는 거리보다 넓다', () => {
    expect(VIEW.back).toBeGreaterThan(ENEMY.approachDistance);
  });

  /**
   * **좌우를 보지 않아도 되는 이유.** 겨눔을 자르는 자(`enemyAi`의 `outOfView`)는
   * 화면 세로 방향만 본다. 그래도 되는 것은 **겨누는 거리(15m) 안에서는 좌우가 한 번도
   * 걸리지 않기 때문**이다 — 가장 좁은 16:9에서도 화면 맨 아랫줄의 폭이 ±12.5m다.
   *
   * 여기가 깨지면(시야각을 좁히거나 `fireRange`를 늘리면) `outOfView`는 좌우를 함께 봐야 한다.
   * 그래서 그 사실을 말로 적지 않고 격자로 훑어 증명해 둔다.
   */
  it('겨누는 거리 안에서는 좌우가 걸리지 않는다', () => {
    for (const aspect of [MOBILE, DESKTOP]) {
      const rig = makeProjector(aspect);
      rig.place({ x: 0, y: 0 });
      for (let dy = -VIEW.forward; dy <= VIEW.back; dy += 0.1) {
        const dx = Math.sqrt(Math.max(0, ENEMY.fireRange ** 2 - dy ** 2));
        // **발밑(선 자리)으로 잰다.** 창이 자르는 것도 선 자리이고, 화면 위쪽 끝에서는
        // 발이 화면 안이라도 머리가 위로 잘린다 — 그건 안 보이는 것이 아니라 잘린 것이다.
        expect(isOffScreen(rig.project(dx, dy, 0)), `dx ${dx.toFixed(1)} dy ${dy.toFixed(1)}`).toBe(false);
      }
    }
  });

  /**
   * **다른 두 종류는 이 창에 닿지도 않는다.** 돌진형은 8m에서 웅크리고 방패병은 11m에서
   * 겨눈다 — 둘 다 창(12.3m) 안쪽이라 `outOfView`가 한 번도 걸리지 않는다.
   * 누군가 그 거리를 늘리면 여기가 먼저 걸려서, 그때 이 규칙을 함께 봐야 한다는 것을 알린다.
   */
  it('돌진형과 방패병의 예고는 창 안에서 시작된다', () => {
    expect(CHARGER.triggerRange).toBeLessThanOrEqual(VIEW.back);
    expect(SHIELD.fireRange).toBeLessThanOrEqual(VIEW.back);
  });
});

/** 판을 돌려 재는 자가 보는 씨앗. 20판은 `npm test` 한 번에 3초를 더 쓴다. */
const MATCH_SEEDS = Array.from({ length: 10 }, (_, i) => 20260909 + i);
const MATCH_SECONDS = 240;

/**
 * **한 판을 통째로 돌려 "안 보이는 곳에서 벌어진 일"의 몫을 잰다.**
 *
 * 이 검사가 여기 있는 이유는 세션 49다. 세션 30이 카메라를 뒤로 빼며 치른 값(몸 크기
 * 3.86 → 3.60%)으로 얻은 수치가 **다른 바퀴의 수정에 조용히 밀렸다** — 적이 다시 서는
 * 자리를 옮기자 안 보이는 데서 겨누는 몫이 1.6% → 5.7%로 뛰었는데, 그 수치는 주석과
 * 표를 찍는 자(`tests/perf/camera.perf.ts`)에만 있었으므로 `npm test` 288개가 전부
 * 통과했다. **한 번 값을 치르고 얻은 수치에는 자를 대 둔다.**
 *
 * 표(`camera.perf.ts`)와 재는 방법이 같지만 하는 일이 다르다 — 표는 후보 카메라를
 * 견주려고 찍고, 여기는 **지금 화면의 값에 선을 긋는다.** 그래서 씨앗을 절반만 쓰고
 * 후보도 하나뿐이다(`npm test`는 매 바퀴 도는 자리다).
 */
describe('화면 — 안 보이는 곳에서 겨누고 쏘는 일', () => {
  it('겨눔은 화면 안에서 시작되고, 화살도 거의 다 화면 안에서 태어난다', () => {
    const rigs = [MOBILE, DESKTOP].map((aspect) => ({ aspect, rig: makeProjector(aspect) }));
    let aiming = 0;
    let offAiming = 0;
    let shots = 0;
    let offShots = 0;

    for (const seed of MATCH_SEEDS) {
      const world = new World({ seed });
      const counted = new Set<number>();
      for (let frame = 0; frame < 60 * MATCH_SECONDS && !world.defeated; frame += 1) {
        play(world, 1, walkToNearestCore, preferPower);
        // 새로 태어난 적 화살만 센다. 매 프레임 세면 "느린 화살일수록 자주 밖"을 재게 된다.
        const fresh = world.arrows.filter((a) => a.owner === 'enemy' && !counted.has(a.id));
        for (const arrow of fresh) counted.add(arrow.id);
        // 몸을 보는 것은 6프레임에 한 번이면 넉넉하다(표와 같은 간격).
        const lookAtBodies = frame % 6 === 0;
        if (fresh.length === 0 && !lookAtBodies) continue;

        for (const { rig } of rigs) {
          rig.place(world.player.pos);
          for (const arrow of fresh) {
            shots += 1;
            if (isOffScreen(rig.project(arrow.pos.x, arrow.pos.y, ARROW.height))) offShots += 1;
          }
          if (!lookAtBodies) continue;
          for (const enemy of world.enemies) {
            if (!enemy.alive || enemy.aimTimer <= 0) continue;
            aiming += 1;
            // 몸의 어느 귀퉁이도 화면에 없으면 통째로 화면 밖이다.
            const seen = BODY_CORNERS.some(
              ([dx, dy, h]) => !isOffScreen(rig.project(enemy.pos.x + dx, enemy.pos.y + dy, h)),
            );
            if (!seen) offAiming += 1;
          }
        }
      }
    }

    expect(aiming).toBeGreaterThan(1000);
    expect(shots).toBeGreaterThan(1000);

    /**
     * **겨눔은 화면 안에서만 시작된다**(`enemyAi`의 `outOfView`). 그래도 0이 아닌 것은
     * 시작한 뒤에 플레이어가 달려 화면 밖으로 밀어내는 경우가 있어서다 —
     * 그것은 예고를 보고 피한 것이므로 겨눔을 거둬들이지 않는다.
     * **이 자로 잰 실측 0.55%** — 같은 자로 고치기 전을 재면 6.67%다(자에 이가 있다).
     */
    expect(offAiming / aiming).toBeLessThan(0.02);
    /**
     * 화살은 겨눔이 끝나는 순간 태어나므로 그 0.5초 동안 달아난 몫만 밖에서 난다.
     * **이 자로 잰 실측 6.15%**(고치기 전 10.25%). 화면비 둘을 함께 세므로 표
     * (`camera.perf.ts` · 모바일 5.8% · 16:9 6.4%)와 값이 조금 다르다 — 표는 갈라 센다.
     */
    expect(offShots / shots).toBeLessThan(0.075);
  });
});
