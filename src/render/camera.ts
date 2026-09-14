import * as THREE from 'three';
import type { Vec2 } from '../core/math';

/**
 * 쿼터뷰 카메라의 규칙은 **전부 이 파일에 있다.** 화면(`Renderer`)도, 화면을 재는 자
 * (`tests/camera.test.ts` · `tests/perf/camera.perf.ts`)도 여기 있는 것만 쓴다.
 *
 * **재는 쪽에서 카메라를 다시 세우지 마라.** 세션 26~28이 도구 쪽에서 세 번 겪은 일이
 * 전부 같은 종류다 — 재는 자가 화면과 조금씩 다른 것을 세워 두고, 그 수치가 화면의
 * 수치인 줄 알고 STATUS에 적혔다. 여기가 어긋나면 그때는 아무도 눈치채지 못한다.
 */

/**
 * 쿼터뷰 카메라가 **보는 점으로부터** 떨어져 있는 자리.
 * 여기 두는 이유: 적 머리 위 체력바가 카메라를 마주 보는 각도가 이 값에서 나온다
 * (`models.ts`의 `createHealthBar`). 카메라는 돌지 않으므로 각도를 한 번 구해 두면
 * 어느 자리에서나 맞는다(원근 때문에 화면 가장자리에서 아주 조금 기울지만 눈에 띄지 않는다).
 *
 * **기울기(51.1°)는 세션 29에서도 그대로다. 자리만 1.1배 멀어졌다** —
 * 기울기를 바꾸면 위의 체력바 각도와 화면에 찍히는 몸의 모양이 함께 바뀐다.
 */
export const CAMERA_OFFSET = { x: 0, y: 17.1, z: 13.8 } as const;
export const CAMERA_TILT = Math.atan2(CAMERA_OFFSET.y, CAMERA_OFFSET.z);

/**
 * 카메라가 보는 점을 플레이어보다 이만큼 뒤(+z)에 둔다(m). 플레이어는 그만큼 화면 위로 올라간다.
 *
 * **왜 필요한가**: 기울여 내려다보는 카메라는 앞뒤로 고르게 보지 않는다. 이 값이 0이면
 * 플레이어 앞으로 16.5m가 보이는데 뒤로는 8.1m뿐이라, **활잡이가 서 있는 띠(8~12m)의
 * 뒤쪽 절반이 화면 밖**이었다. 겨누는 적의 9.0%(모바일)·11.4%(16:9)가 안 보이는 곳에서
 * 겨눴고, 적이 쏜 화살의 10.7%·15.7%가 화면 밖에서 날아들었다 — 예고를 볼 수 없으면
 * 피할 방법이 없다(DESIGN "처음 하는 사람이 설명 없이 30초 안에").
 *
 * **왜 이 두 값인가**(세션 30이 다시 잰 값 · 씨앗 20판 · `npm run perf`의 카메라 표):
 * 보는 점만 뒤로 밀면 뒤가 나아진 만큼 옆이 잘려 총량이 그대로다
 * (뒤로만 3.5 밀면 밖에서 쏘는 화살이 10.7% → 12.0%로 오히려 는다 —
 * 뒤에서 드는 것 232 → 64발, 옆에서 드는 것 46 → 247발).
 * **자리를 1.1배 빼면서 함께 밀어야 사방이 같이 넓어진다** — 앞 14.7 · 뒤 12.4 · 옆 16.6m(16:9)로
 * 활잡이의 띠(12m)를 사방에서 덮는다. 그 값에서 겨누는데 안 보이는 적 **9.0% → 1.6%**,
 * 화면 밖에서 날아든 화살 **10.7% → 5.5%**(모바일 기준)이고, 적의 몸이 통째로 화면 밖인
 * 프레임이 43% → 29%로 줄어든다.
 * 치른 값은 화면에 찍히는 몸의 크기다(키 1m이 화면 높이의 3.86% → 3.60%).
 * 더 빼면(1.15배) 겨눔 1.0%까지 가지만 3.46%로 더 작아져, 모바일 우선 원칙에 따라 여기서 멈췄다
 * (`tests/camera.test.ts`가 3.5%에 바닥을 두어 이 결정을 붙잡는다).
 *
 * **세션 29가 적어 둔 수치는 스무 판이 아니라 한 판이었다** — 임시 자가 씨앗을
 * `new World(seed)`로 넣어(`WorldOptions`는 객체다) 스무 번 같은 판을 돌렸다.
 * 방향은 같았지만 값은 전부 달랐다. 그래서 자를 `tests/perf/camera.perf.ts`에 못 박았다.
 */
export const CAMERA_FOCUS_BACK = 3.5;

/**
 * **세션 50이 위 두 값에 붙인 한 줄.** 여기 적힌 "활잡이의 띠(8~12m)"는 적이 **다가와
 * 서는** 띠이지 **겨누는** 띠가 아니었다. 활잡이는 `fireRange`(15m) 안에 들어오는
 * 순간부터 겨누므로, 실제로는 겨눔의 43%가 14~16m에서 일어난다(실측). 뒤로 보이는
 * 거리는 12.4m뿐이라 **플레이어 뒤 15m에 선 적은 화면 밖에 선 채로 쏘았다.**
 *
 * 그것을 카메라로 메우려면 1.15배 이상 빼야 하는데, 그 값은 모바일에서 몸이
 * 3.46%로 작아져 여기서 이미 거절한 길이다. 그래서 카메라가 아니라 **적 쪽을 고쳤다** —
 * 적은 `data/config.ts`의 `VIEW` 안에서만 겨누기를 시작한다(`systems/enemyAi.ts`의
 * `outOfView`). `VIEW`는 여기서 나온 값이고 `tests/camera.test.ts`가 둘을 견준다.
 */

/**
 * 시야각(°)과 자르는 면. **시야각은 넓힐 수 없다** — 넓히면 사방이 넓어지는 대신
 * 원근이 세져 화면 가장자리의 적이 누워 보인다(세션 26·28이 화면에서 본 것).
 * 사방을 넓히는 것은 `CAMERA_OFFSET`과 `CAMERA_FOCUS_BACK`이 할 일이다.
 */
export const CAMERA_FOV = 46;
export const CAMERA_NEAR = 0.5;
export const CAMERA_FAR = 220;

/** 게임 카메라. 화면과 재는 자가 같은 렌즈를 쓰게 하는 유일한 자리다. */
export function createGameCamera(aspect = 1): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
}

/**
 * 카메라가 보는 점. 플레이어가 아니라 플레이어보다 `CAMERA_FOCUS_BACK`만큼 뒤(+z)다.
 * `out`을 주면 거기에 담는다 — 매 프레임 부르는 자리(`Renderer.syncCamera`)가 있어서다.
 */
export function cameraFocusFor(pos: Vec2, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(pos.x, 0, pos.y + CAMERA_FOCUS_BACK);
}

/** 보는 점에 맞춰 카메라를 세운다. 자리도 보는 점 기준이라 기울기는 `CAMERA_TILT` 그대로다. */
export function placeCamera(camera: THREE.Camera, focus: THREE.Vector3): void {
  camera.position.set(focus.x + CAMERA_OFFSET.x, CAMERA_OFFSET.y, focus.z + CAMERA_OFFSET.z);
  camera.lookAt(focus);
}

/**
 * 지금 이 카메라로 바닥이 어디까지 보이는가(m). **플레이어를 원점으로 잰 거리다** —
 * 적도 화살도 플레이어를 기준으로 서기 때문이다(활잡이의 띠 8~12m 따위).
 * `forward`는 화면 위쪽 끝, `back`은 아래쪽 끝, `side`는 좌우 끝이 닿는 바닥 자리.
 *
 * 화면비를 받는 이유: 앞뒤는 화면비와 무관하지만 **옆은 화면비에 따라 달라진다**
 * (세로로 자른 16:9가 가로로 긴 모바일보다 3.6m 좁다). 사방을 재는 검사는 둘 다 봐야 한다.
 */
export function groundExtent(aspect: number): { forward: number; back: number; side: number } {
  const camera = createGameCamera(aspect);
  // 플레이어를 원점에 두고 그 규칙대로 카메라를 세운다.
  placeCamera(camera, cameraFocusFor({ x: 0, y: 0 }));
  camera.updateMatrixWorld(true);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const edge = (nx: number, ny: number): THREE.Vector3 | null => {
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  };

  const top = edge(0, 1);
  const bottom = edge(0, -1);
  const right = edge(1, 0);

  // 위쪽 끝은 하늘을 볼 수도 있다 — 그때는 앞이 무한히 보인다(기울기를 눕히면 그렇게 된다).
  return {
    forward: top ? -top.z : Infinity,
    back: bottom ? bottom.z : Infinity,
    side: right ? right.x : Infinity,
  };
}
