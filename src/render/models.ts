import * as THREE from 'three';
import { ARENA, ARROW, PLAYER, TARGET } from '../data/config';

/**
 * 모든 도형 생성은 이 파일 안에서만 한다.
 * 나중에 실제 모델로 갈아끼울 때 고칠 곳을 한 군데로 묶어 두기 위해서다.
 * (DESIGN: 로우폴리 프리미티브 — 외부 모델·텍스처를 쓰지 않는다)
 */

export const PALETTE = {
  ground: 0x1a2340,
  groundEdge: 0x2b3a66,
  grid: 0x33457a,
  wall: 0x3a4c85,
  player: 0x5ec8ff,
  playerDark: 0x2b7fb8,
  arrow: 0xffe6a3,
  target: 0xff6b6b,
  targetHit: 0xfff1b8,
  accent: 0xffd479,
} as const;

function standard(color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
}

/** 바닥 + 격자 + 테두리 벽. 아레나는 한 번 만들고 다시 만들지 않는다. */
export function createArena(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'arena';

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA.radius, 72),
    standard(PALETTE.ground, { roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  group.add(createGrid());

  // 테두리 벽: 원기둥의 옆면만 쓴다. 안쪽에서도 보이게 양면으로.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA.radius, ARENA.radius, 1.1, 72, 1, true),
    standard(PALETTE.wall, { side: THREE.DoubleSide, roughness: 0.6 }),
  );
  wall.position.y = 0.55;
  group.add(wall);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA.radius, 0.09, 6, 96),
    new THREE.MeshBasicMaterial({ color: PALETTE.groundEdge }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 1.1;
  group.add(rim);

  return group;
}

/** 원 안쪽으로 잘라낸 격자. 잘라내지 않으면 벽 밖으로 선이 삐져나온다. */
function createGrid(): THREE.LineSegments {
  const points: number[] = [];
  const r = ARENA.radius;
  const step = ARENA.gridStep;
  for (let c = -Math.floor(r / step) * step; c <= r; c += step) {
    const half = Math.sqrt(Math.max(r * r - c * c, 0));
    if (half < 0.5) continue;
    points.push(c, 0, -half, c, 0, half);
    points.push(-half, 0, c, half, 0, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: PALETTE.grid, transparent: true, opacity: 0.5 }),
  );
  lines.position.y = 0.02;
  return lines;
}

/** 플레이어. -Z 방향을 앞으로 삼는다(Three.js 기본 정면). */
export function createPlayer(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'player';

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(PLAYER.radius * 0.8, PLAYER.radius, PLAYER.height * 0.62, 8),
    standard(PALETTE.player, { roughness: 0.45 }),
  );
  body.position.y = PLAYER.height * 0.31;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(PLAYER.radius * 0.58, 12, 8),
    standard(PALETTE.playerDark, { roughness: 0.4 }),
  );
  head.position.y = PLAYER.height * 0.78;
  head.castShadow = true;
  group.add(head);

  // 앞을 가리키는 코. 방향이 보이지 않으면 조준이 어디로 가는지 알 수 없다.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.6, 6),
    standard(PALETTE.accent, { roughness: 0.3 }),
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, PLAYER.height * 0.5, -PLAYER.radius - 0.22);
  group.add(nose);

  const shadowRing = new THREE.Mesh(
    new THREE.RingGeometry(PLAYER.radius * 0.9, PLAYER.radius * 1.15, 24),
    new THREE.MeshBasicMaterial({
      color: PALETTE.player,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  shadowRing.rotation.x = -Math.PI / 2;
  shadowRing.position.y = 0.03;
  group.add(shadowRing);

  return group;
}

/** 화살 한 발. 축은 -Z가 진행 방향. */
export function createArrow(): THREE.Group {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(ARROW.radius * 0.7, ARROW.radius * 0.7, 0.95, 5),
    standard(PALETTE.arrow, { emissive: PALETTE.arrow, emissiveIntensity: 0.35 }),
  );
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(ARROW.radius * 1.5, 0.5, 6),
    standard(PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.6 }),
  );
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.66;
  group.add(tip);

  return group;
}

/** 자동 조준 대상. 5번에서 실제 적 모델이 이 자리를 대신한다. */
export function createTarget(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(TARGET.radius, TARGET.radius * 0.85, TARGET.height, 6),
    standard(PALETTE.target, { roughness: 0.5 }),
  );
  body.position.y = TARGET.height / 2;
  body.castShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(TARGET.radius * 0.55, 10, 6),
    standard(PALETTE.targetHit, { roughness: 0.35 }),
  );
  cap.position.y = TARGET.height + TARGET.radius * 0.25;
  group.add(cap);

  return group;
}

/** 자동 조준이 잡은 대상 아래에 깔리는 표식. */
export function createLockMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(TARGET.radius * 1.25, TARGET.radius * 1.55, 6),
    new THREE.MeshBasicMaterial({
      color: PALETTE.accent,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.04;
  marker.visible = false;
  return marker;
}
