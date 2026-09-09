import * as THREE from 'three';
import type { ArrowOwner } from '../entities/types';
import { ARENA, ARROW, CORE, ENEMY, PLAYER } from '../data/config';

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
  /** 적의 화살. 플레이어의 것과 색이 달라야 "저건 피해야 하는 것"으로 읽힌다. */
  enemyArrow: 0xff8a5c,
  enemy: 0xff6b6b,
  enemyDark: 0xc1354a,
  enemyHit: 0xfff1b8,
  accent: 0xffd479,
  core: 0x7bffcf,
  coreDrop: 0xa6ff5e,
} as const;

/**
 * 쿼터뷰 카메라가 플레이어로부터 떨어져 있는 자리.
 * 여기 두는 이유: 적 머리 위 체력바가 카메라를 마주 보는 각도가 이 값에서 나온다.
 * 카메라는 돌지 않으므로 각도를 한 번 구해 두면 어느 자리에서나 맞는다
 * (원근 때문에 화면 가장자리에서 아주 조금 기울지만 눈에 띄지 않는다).
 */
export const CAMERA_OFFSET = { x: 0, y: 15.5, z: 12.5 } as const;
export const CAMERA_TILT = Math.atan2(CAMERA_OFFSET.y, CAMERA_OFFSET.z);

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

/**
 * 화살 한 발. 축은 -Z가 진행 방향.
 * 주인에 따라 색이 다르다 — 날아오는 것이 내 것인지 적 것인지 한눈에 갈려야 한다.
 */
export function createArrow(owner: ArrowOwner): THREE.Group {
  const enemy = owner === 'enemy';
  const shaftColor = enemy ? PALETTE.enemyArrow : PALETTE.arrow;
  const tipColor = enemy ? PALETTE.enemyDark : PALETTE.accent;

  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(ARROW.radius * 0.7, ARROW.radius * 0.7, 0.95, 5),
    standard(shaftColor, { emissive: shaftColor, emissiveIntensity: enemy ? 0.55 : 0.35 }),
  );
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(ARROW.radius * 1.5, 0.5, 6),
    standard(tipColor, { emissive: tipColor, emissiveIntensity: 0.6 }),
  );
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.66;
  group.add(tip);

  return group;
}

/**
 * 적 한 마리가 쓰는 것들. 매 프레임 만지는 부분(재질·체력바·예고 고리)을
 * 이름으로 다시 찾지 않도록 만들 때 함께 돌려준다.
 */
export interface EnemyView {
  group: THREE.Group;
  /** 겨눌 때 달아오르게 하려고 들고 있는다. 적마다 따로 만든 재질이다. */
  bodyMaterial: THREE.MeshStandardMaterial;
  /** 체력바의 채워진 부분. scale.x로 줄인다. */
  hpFill: THREE.Mesh;
  /** 체력바 전체. 가득 찼을 때는 숨긴다. */
  hpBar: THREE.Group;
  /** 겨누는 동안 발밑에서 좁혀지는 고리. */
  aimRing: THREE.Mesh;
}

/** 적 봇. 앞(-Z)에 활을 든 팔이 있어서 어느 쪽을 겨누는지 보인다. */
export function createEnemy(): EnemyView {
  const group = new THREE.Group();
  group.name = 'enemy';

  const bodyMaterial = standard(PALETTE.enemy, { roughness: 0.5 });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(ENEMY.radius, ENEMY.radius * 0.85, ENEMY.height, 6),
    bodyMaterial,
  );
  body.position.y = ENEMY.height / 2;
  body.castShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(ENEMY.radius * 0.55, 10, 6),
    standard(PALETTE.enemyHit, { roughness: 0.35 }),
  );
  cap.position.y = ENEMY.height + ENEMY.radius * 0.25;
  group.add(cap);

  // 겨누는 쪽을 가리키는 짧은 팔. 플레이어의 코와 같은 역할이다.
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.7),
    standard(PALETTE.enemyDark, { roughness: 0.4 }),
  );
  arm.position.set(0, ENEMY.height * 0.62, -ENEMY.radius - 0.28);
  group.add(arm);

  const aimRing = new THREE.Mesh(
    new THREE.RingGeometry(ENEMY.radius * 1.1, ENEMY.radius * 1.35, 24),
    new THREE.MeshBasicMaterial({
      color: PALETTE.enemyArrow,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.position.y = 0.05;
  aimRing.visible = false;
  group.add(aimRing);

  const { bar, fill } = createHealthBar();
  bar.position.y = ENEMY.height + ENEMY.radius * 0.9;
  group.add(bar);

  return { group, bodyMaterial, hpFill: fill, hpBar: bar, aimRing };
}

/**
 * 적 머리 위 체력바. 판 두 장(바탕·채움)으로 만든다.
 *
 * 카메라가 돌지 않는 쿼터뷰라서, 카메라를 마주 보는 각도를 한 번 고정해 두면
 * 매 프레임 방향을 다시 계산할 필요가 없다(적 20마리면 그 계산이 그냥 낭비다).
 * 채움은 지오메트리를 옆으로 밀어 두어 scale.x가 왼쪽 끝에 붙어 줄어들게 한다 —
 * 가운데에서 양쪽으로 줄어들면 체력바로 읽히지 않는다.
 */
function createHealthBar(): { bar: THREE.Group; fill: THREE.Mesh } {
  const width = ENEMY.radius * 2.4;
  const height = 0.16;

  const bar = new THREE.Group();
  bar.rotation.x = -CAMERA_TILT;

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 0.07, height + 0.07),
    new THREE.MeshBasicMaterial({ color: 0x0b1020, transparent: true, opacity: 0.72 }),
  );
  bar.add(back);

  const fillGeometry = new THREE.PlaneGeometry(width, height);
  fillGeometry.translate(width / 2, 0, 0.001);
  const fill = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({ color: PALETTE.enemyArrow }),
  );
  fill.position.x = -width / 2;
  bar.add(fill);

  return { bar, fill };
}

/** 자동 조준이 잡은 적 아래에 깔리는 표식. */
export function createLockMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(ENEMY.radius * 1.25, ENEMY.radius * 1.55, 6),
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

/**
 * 경험치 코어. 팔면체 하나로 만든다 — 아레나의 기둥·구·원기둥과 겹치지 않는
 * 유일한 형태라, 작게 그려도 "저건 주우러 가는 것"으로 읽힌다.
 * 드롭은 색을 달리해서 맵에 놓인 것보다 값지다는 것을 보여 준다.
 */
export function createCore(drop: boolean): THREE.Mesh {
  const color = drop ? PALETTE.coreDrop : PALETTE.core;
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(CORE.radius * (drop ? 1.25 : 1.0)),
    // emissive를 세게 주면 모든 면이 같은 밝기가 되어 납작한 사각형으로 보인다.
    // 빛나되 면의 음영이 남을 만큼만 준다 — 그래야 각진 결정처럼 읽힌다.
    standard(color, { emissive: color, emissiveIntensity: 0.4, roughness: 0.35 }),
  );
  mesh.castShadow = false;
  return mesh;
}
