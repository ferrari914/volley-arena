import * as THREE from 'three';
import type { ArrowOwner, EnemyKind } from '../entities/types';
import { ARENA, ARROW, CORE, ENEMY, PLAYER, SHIELD } from '../data/config';

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
  /**
   * 돌진형(DESIGN 9번). 활잡이의 붉은색과 멀리서도 갈려야 한다 —
   * 둘이 섞인 화면에서 "어느 쪽이 달려오는가"를 색 하나로 읽을 수 있어야 하기 때문이다.
   * 아레나(남색)·플레이어(하늘)·코어(민트)·화살(크림/주황) 어느 것과도 겹치지 않는 자리다.
   */
  charger: 0xa678ff,
  chargerDark: 0x5f37c9,
  /**
   * 방패병(DESIGN 9번). 붉은 활잡이·보라 돌진형과 또 갈려야 한다.
   * 차가운 청록으로 둔 이유: 이 적에게 요구되는 것은 쫓기는 다급함이 아니라
   * "돌아서 서라"는 자리 잡기이고, 무겁고 단단한 색이 그 성격을 먼저 알린다.
   */
  shield: 0x4fd1c5,
  shieldDark: 0x1f6f6b,
  /** 방패가 화살을 받아 낸 순간 번쩍이는 색. 몸이 아니라 방패만 밝아진다. */
  shieldSpark: 0xe6fffb,
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
/**
 * 플레이어 모델과, 렌더러가 매 프레임 만져야 하는 부분들.
 * 적(`EnemyView`)과 같은 방식이다 — 씬을 이름으로 뒤지지 않게 손잡이를 함께 돌려준다.
 */
export interface PlayerView {
  group: THREE.Group;
  /** 무적일 때만 보이는 보호막. 화살이 몸을 그냥 통과하는 이유를 화면에 적어 준다. */
  shield: THREE.Mesh;
  shieldMaterial: THREE.MeshBasicMaterial;
}

export function createPlayer(): PlayerView {
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

  /*
   * 무적 보호막. 부활 직후(3초)와 한 대 맞은 직후(0.55초)에 켜진다.
   * 이것이 없으면 적의 화살이 몸을 그대로 통과하는 그림만 남아 고장처럼 읽힌다 —
   * 특히 광고를 보고 막 일어선 사람에게는 "이어하기가 된 건가?"가 된다.
   * depthWrite를 끄는 이유: 반투명 껍질이 그 안의 몸을 가리지 않게 한다.
   */
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.player,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(PLAYER.radius * 1.9, 16, 12), shieldMaterial);
  shield.position.y = PLAYER.height * 0.5;
  shield.visible = false;
  group.add(shield);

  return { group, shield, shieldMaterial };
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
  /**
   * 몸통·머리·팔만 담긴 안쪽 묶음. 조준 방향으로 도는 것은 여기다.
   * 바깥 묶음을 돌리면 그 안의 체력바까지 함께 돌아가서, 적이 등을 보이는 순간
   * 체력바가 뒤집혀 사라진다(실제로 그렇게 만들었다가 스크린샷에서 잡았다).
   */
  pivot: THREE.Group;
  /** 겨눌 때 달아오르게 하려고 들고 있는다. 적마다 따로 만든 재질이다. */
  bodyMaterial: THREE.MeshStandardMaterial;
  /** 체력바의 채워진 부분. scale.x로 줄인다. */
  hpFill: THREE.Mesh;
  /** 체력바 전체. 가득 찼을 때는 숨긴다. */
  hpBar: THREE.Group;
  /** 겨누는 동안 발밑에서 좁혀지는 고리. */
  aimRing: THREE.Mesh;
  /**
   * 방패병이 앞세운 판이 매달린 돌쩌귀(DESIGN 9번). 다른 종류는 null이다.
   * 겨누는 동안 눕혀 내리고, 방패가 다 부서지면 통째로 숨긴다.
   */
  shieldPlate: THREE.Group | null;
  /** 방패가 화살을 받아 냈을 때 번쩍이게 하려고 들고 있는다. */
  shieldMaterial: THREE.MeshStandardMaterial | null;
}

/**
 * 적 봇. 종류에 따라 몸이 다르다(DESIGN 9번).
 *
 * **몸 반지름은 종류가 같다**(`ENEMY.radius`) — 화살 판정이 하나의 반지름을 쓰므로,
 * 화면에서만 굵어 보이면 "맞았는데 안 맞았다"가 된다. 그래서 갈라 두는 것은
 * 색·높이·모양뿐이다:
 *   활잡이  — 길쭉한 붉은 기둥에 겨누는 팔. 멀리서 쏜다.
 *   돌진형  — 낮고 넓은 보라 덩어리에 앞으로 뻗은 뿔. 부딪으러 온다.
 *   방패병  — 청록 기둥 앞에 정면을 두른 곡면 판. 그 판이 곧 규칙이다.
 * 낮고 넓게 만든 이유: 같은 반지름이라도 무게가 실려 보여야 "저건 달려온다"로 읽힌다.
 *
 * **방패병만 부품 하나가 몸 앞에 따로 선다**(`shieldPlate`). 화살을 막는 것이
 * 몸이 아니라 그 판이고, 그 판이 **어느 각을 두르고 있는지**가 화면에 그대로 적혀 있어야
 * 한다 — 그래야 "옆으로 돌면 열린다"를 설명 없이 알아본다(DESIGN 품질 기준의 30초).
 */
export function createEnemy(kind: EnemyKind = 'archer'): EnemyView {
  const group = new THREE.Group();
  group.name = kind;
  const pivot = new THREE.Group();
  group.add(pivot);

  const charger = kind === 'charger';
  const shield = kind === 'shield';
  const height = charger ? ENEMY.height * 0.62 : shield ? SHIELD_BODY_HEIGHT : ENEMY.height;
  const bodyMaterial = standard(
    charger ? PALETTE.charger : shield ? PALETTE.shield : PALETTE.enemy,
    { roughness: charger ? 0.35 : 0.5 },
  );
  const body = new THREE.Mesh(
    charger
      ? new THREE.BoxGeometry(ENEMY.radius * 1.7, height, ENEMY.radius * 1.5)
      : new THREE.CylinderGeometry(
          ENEMY.radius * (shield ? 0.8 : 1),
          ENEMY.radius * 0.85,
          height,
          shield ? 8 : 6,
        ),
    bodyMaterial,
  );
  body.position.y = height / 2;
  body.castShadow = true;
  pivot.add(body);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(ENEMY.radius * 0.55, 10, 6),
    standard(
      charger ? PALETTE.chargerDark : shield ? PALETTE.shieldDark : PALETTE.enemyHit,
      { roughness: 0.35 },
    ),
  );
  cap.position.y = height + ENEMY.radius * 0.25;
  pivot.add(cap);

  if (charger) {
    // 앞으로 뻗은 뿔. 돌진 방향이 몸의 정면이라는 것을 화면에 적어 준다
    // (활잡이의 팔·플레이어의 코와 같은 역할이다).
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(ENEMY.radius * 0.42, 0.9, 5),
      standard(PALETTE.chargerDark, { roughness: 0.3 }),
    );
    horn.rotation.x = -Math.PI / 2;
    horn.position.set(0, height * 0.55, -ENEMY.radius - 0.35);
    pivot.add(horn);
  } else {
    // 겨누는 쪽을 가리키는 짧은 팔. 플레이어의 코와 같은 역할이다.
    // **방패병의 팔은 몸에 붙여 둔다** — 방패 안쪽에 들어가 있어야 방패를 뚫고 나오지 않고,
    // 방패가 내려간 동안에만 드러나 "지금 저 팔이 열려 있다"가 함께 보인다.
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.7),
      standard(shield ? PALETTE.shieldDark : PALETTE.enemyDark, { roughness: 0.4 }),
    );
    arm.position.set(0, height * 0.62, shield ? -ENEMY.radius * 0.5 : -ENEMY.radius - 0.28);
    pivot.add(arm);
  }

  const aimRing = new THREE.Mesh(
    new THREE.RingGeometry(ENEMY.radius * 1.1, ENEMY.radius * 1.35, 24),
    new THREE.MeshBasicMaterial({
      color: charger ? PALETTE.charger : shield ? PALETTE.shield : PALETTE.enemyArrow,
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
  bar.position.y = height + ENEMY.radius * 0.9;
  group.add(bar);

  const plate = shield ? createShieldPlate(pivot, height) : null;

  return {
    group,
    pivot,
    bodyMaterial,
    hpFill: fill,
    hpBar: bar,
    aimRing,
    shieldPlate: plate?.pivot ?? null,
    shieldMaterial: plate?.material ?? null,
  };
}

/**
 * 방패판의 크기. 몸 반지름·키에 대한 배율로 둔다 — 몸이 바뀌면 방패도 따라가야 한다.
 * **막는 각은 여기 없다.** 그것은 `SHIELD.arc` 하나뿐이고, 판은 그 값을 두르기만 한다.
 */
const SHIELD_PLATE = { radiusScale: 1.3, heightScale: 0.46 } as const;

/** 방패병의 몸 키. 방패의 자세가 이 값에서 나오므로 상수로 빼 둔다. */
const SHIELD_BODY_HEIGHT = ENEMY.height * 0.88;

/**
 * 방패의 두 자세 — 돌쩌귀의 높이(m)와 기울기(rad). Renderer가 그 사이를 오간다.
 *
 * **올린 자세는 가슴 높이다.** 판이 발밑까지 내려오면 든 방패가 아니라 세워 둔 벽으로
 * 보이고, 무엇보다 내렸을 때와 높이 차가 나지 않아 예고가 안 보인다.
 *
 * **내린 자세는 바닥에 닿지 않는 선에서 가장 낮은 자리다.** 판이 곡면이라 양 끝이
 * 가운데보다 아래로 처지므로, 앞쪽 아랫변이 아니라 **옆쪽 아랫변**이 바닥을 정한다
 * (이 값에서 옆쪽 아랫변이 y≈0.01이다). 여기서 더 내리면 방패가 바닥을 파고든다.
 *
 * 두 자세의 윗변 차이는 0.49m다 — 적의 키(2.23m)의 5분의 1이 넘게 움직인다.
 */
export const SHIELD_POSE = {
  raisedY: SHIELD_BODY_HEIGHT * 0.9,
  raisedTilt: 0,
  loweredY: SHIELD_BODY_HEIGHT * 0.36,
  loweredTilt: 0.45,
} as const;

/**
 * 방패병이 앞세우는 판 (DESIGN 9번).
 *
 * **판은 `SHIELD.arc`가 막는 각을 그대로 두른 곡면이다.** 평평한 널을 세워 두지 않는
 * 이유가 여기 있다 — 몸 앞을 가로지르는 널은 보이는 각과 막는 각이 다르다.
 * 반지름 2.2배짜리 널을 몸에 붙여 세우면 눈에는 ±45°로 보이는데 실제로는 ±75°를
 * 막는다. 그러면 "저만큼 비켰는데 또 튕겼다"가 되고, 이 적의 유일한 규칙이 거짓말이 된다.
 * 원통의 벽을 `SHIELD.arc`만큼만 잘라 두면 **화면에 보이는 그 구간이 곧 막는 구간**이다.
 *
 * **겨눌 때는 내려간다.** 그냥 숨기면 "방패가 사라졌다"로 보이지만, 발밑까지 내려가
 * 앞으로 기우는 것은 "지금 쏘려고 방패를 치웠다"로 읽힌다. 그 0.7초(`SHIELD.aimTime`)가
 * 정면이 열리는 유일한 창이므로, 화면에서 가장 또렷해야 하는 움직임이 이것이다.
 * 두 자세는 `SHIELD_POSE`에 있고 Renderer가 그 사이를 오간다.
 *
 * 곡면이라 안쪽 면도 보인다(`DoubleSide`) — 내려가 기울면 플레이어 쪽으로 판의 등이
 * 돌아서는데, 한쪽 면만 그리면 그 순간 방패가 통째로 사라진다.
 */
function createShieldPlate(
  parent: THREE.Group,
  height: number,
): { pivot: THREE.Group; material: THREE.MeshStandardMaterial } {
  const pivot = new THREE.Group();
  pivot.position.y = SHIELD_POSE.raisedY;
  parent.add(pivot);

  const radius = ENEMY.radius * SHIELD_PLATE.radiusScale;
  const plateHeight = height * SHIELD_PLATE.heightScale;
  // 원통의 벽을 정면(−Z, `yawFromAngle`이 맞춰 두는 방향) 기준으로 좌우 `arc`만큼만 남긴다.
  // CylinderGeometry의 각도 0은 +Z라 π에서 시작해야 정면이 한가운데에 온다.
  const arcGeometry = (r: number, h: number, pad: number) =>
    new THREE.CylinderGeometry(r, r, h, 20, 1, true, Math.PI - SHIELD.arc - pad, (SHIELD.arc + pad) * 2);

  const material = standard(PALETTE.shieldDark, {
    roughness: 0.28,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  const plate = new THREE.Mesh(arcGeometry(radius, plateHeight, 0), material);
  // 돌쩌귀는 판의 윗변에 있다. 내려갈 때 위에서부터 사라지는 것이 아니라 통째로 내려간다.
  plate.position.y = -plateHeight / 2;
  plate.castShadow = true;
  pivot.add(plate);

  // 윗변 테두리. 어두운 판만 두면 아레나 바닥(남색)에 묻혀 실루엣이 안 보인다.
  // 판보다 아주 조금 넓게 둘러 판의 양 끝이 어디서 끊기는지를 밝은 색으로 짚어 준다.
  const rim = new THREE.Mesh(
    arcGeometry(radius * 1.04, plateHeight * 0.12, 0.02),
    standard(PALETTE.shield, { roughness: 0.3, side: THREE.DoubleSide }),
  );
  rim.position.y = -plateHeight * 0.06;
  pivot.add(rim);

  return { pivot, material };
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
