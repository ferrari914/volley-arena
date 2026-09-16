import * as THREE from 'three';
import type { ArrowOwner, EnemyKind, Obstacle } from '../entities/types';
import { ARENA, ARROW, BOMBER, CORE, ENEMY, PLAYER, SHIELD } from '../data/config';
import { CAMERA_TILT } from './camera';

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
  /**
   * 기둥(DESIGN 10번). **테두리 벽과 같은 색이다** — 둘 다 "지나갈 수 없는 것"이고,
   * 색이 갈리면 하나는 지형, 하나는 물건으로 읽힌다. 윗면만 조금 밝게 두어
   * 비스듬히 내려다보는 화면에서 바닥과 떨어져 선다(`obstacleTop`).
   */
  obstacleTop: 0x54699f,
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
  /** 방패판. 몸(밝은 청록)보다 어두워야 판이 몸에서 떨어져 나와 보인다. */
  shieldDark: 0x2b8079,
  /**
   * 화살을 받아 낸 순간 판이 번쩍이는 흰빛. **색이 아니라 밝기로 알린다** —
   * 판의 색은 남은 내구도가 이미 쓰고 있어서(`shieldDark` ↔ `shieldSpent`),
   * 번쩍임까지 색을 쓰면 둘이 서로를 지운다(`applyShieldLook`).
   */
  shieldSpark: 0xe6fffb,
  /**
   * 다 닳아 가는 방패판의 색. 청록기가 빠진 잿빛이라 **몸 앞의 검은 띠**로 보인다 —
   * 성한 판(`shieldDark`)과 한 화면에 있을 때 어느 쪽을 마저 부술지 눈으로 갈린다.
   */
  shieldSpent: 0x3a4356,
  /**
   * 폭탄병(DESIGN 9번). **앞의 셋과 갈려야 하는데 따뜻한 쪽은 활잡이가 이미 쓰고 있다** —
   * 그래서 색상이 아니라 **밝기**로 갈랐다. 붉은 활잡이·보라 돌진형·청록 방패병은 전부
   * 어두운 남색 바닥에서 중간 밝기인데, 이 적만 모래빛으로 밝다. 둥근 몸과 함께
   * 멀리서도 "저 흰 공"으로 먼저 읽힌다.
   */
  bomber: 0xd9cfb0,
  /** 몸에 두른 띠와 심지의 밑동. 몸보다 어두워야 둥근 몸이 납작해 보이지 않는다. */
  bomberDark: 0x8a7c56,
  /**
   * 심지가 타는 빛(`BOMBER.fuse`). **터질 원의 고리도 같은 색이다** —
   * 달아오르는 몸과 바닥의 고리가 같은 색이어야 "저 몸이 저 원을 터뜨린다"로 읽힌다.
   * 적의 화살(주황)보다 노랗고 밝다.
   */
  bomberFuse: 0xffb03a,
  /**
   * 파열이 낸 자국(DESIGN 8번 · 파열 카드). **`bomberFuse`에서 가장 멀리 두었다.**
   * 두 자국은 같은 크기의 채워진 원이라 화면에서 갈리는 것은 색뿐인데,
   * 하나는 "나에게 닿으면 아프다"이고 하나는 "내가 번 자리"다. 비슷하면 화면이
   * 처치마다 거짓 경고를 낸다 — 호박빛에 맞서 찬 흰빛으로 둔 이유다.
   * **카드의 색과 같은 값이다**(`data/upgrades.ts`의 `burst`).
   */
  burst: 0xdff3ff,
  accent: 0xffd479,
  core: 0x7bffcf,
  coreDrop: 0xa6ff5e,
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

/**
 * 이 맵의 기둥들(DESIGN 10번). 아레나와 달리 맵마다 다르므로 따로 만들고,
 * 맵을 바꿀 때 이 그룹만 통째로 갈아 끼운다(`Renderer.setMap`).
 *
 * 그림자를 받고 또 드리운다. 기둥이 바닥에 그림자를 떨어뜨려야 **높이가 있는 것**으로
 * 읽힌다 — 그림자가 없으면 바닥에 그린 원처럼 보여서, 지나갈 수 없다는 것이 화면에 없다.
 */
export function createObstacles(obstacles: readonly Obstacle[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'obstacles';
  for (const pillar of obstacles) {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(pillar.radius, pillar.radius * 1.06, OBSTACLE_HEIGHT, 16),
      standard(PALETTE.wall, { roughness: 0.7 }),
    );
    body.position.set(pillar.x, OBSTACLE_HEIGHT / 2, pillar.y);
    body.castShadow = true;
    body.receiveShadow = true;

    // 윗면. 원기둥 뚜껑을 따로 얹어 밝기를 달리 준다 — 위에서 비스듬히 보는 화면이라
    // 이 면이 가장 넓게 보이고, 여기가 어두우면 기둥이 배경에 묻힌다.
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(pillar.radius, 16),
      standard(PALETTE.obstacleTop, { roughness: 0.5 }),
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.set(pillar.x, OBSTACLE_HEIGHT + 0.01, pillar.y);
    group.add(body);
    group.add(cap);
  }
  return group;
}

/**
 * 기둥의 높이(m). 게임은 수평면만 보므로 이 값은 화면에만 있다.
 * 플레이어 키(1.7m)보다 확실히 높아야 "넘어갈 수 없다"로 읽히고,
 * 너무 높으면 쿼터뷰에서 그 뒤의 적을 통째로 가린다.
 */
const OBSTACLE_HEIGHT = 2.6;

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
  /**
   * 겨누는 동안 발밑에서 좁혀지는 고리.
   * **폭탄병만 좁혀지지 않고 터질 원 그대로 서서 깜빡인다**(`createEnemy`).
   */
  aimRing: THREE.Mesh;
  /** 고리의 재질. 폭탄병의 깜빡임이 여기 투명도를 흔든다. */
  ringMaterial: THREE.MeshBasicMaterial;
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
 *   폭탄병  — 바닥에 놓인 모래빛 공에 심지 하나. 둥근 것은 이것뿐이다.
 * 낮고 넓게 만든 이유: 같은 반지름이라도 무게가 실려 보여야 "저건 달려온다"로 읽힌다.
 *
 * **폭탄병에게는 팔도 뿔도 없다.** 앞의 셋은 정면이 뜻을 갖지만(겨누는 쪽 · 달려갈 쪽 ·
 * 막는 쪽) 이 적이 저지르는 것은 방향이 없는 원이다 — 정면을 가리키는 부품을 달면
 * 화면이 "저쪽으로 무언가 한다"는 거짓말을 한다.
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
  const bomber = kind === 'bomber';
  const look = BODY_LOOK[kind];
  const height = look.height;
  const bodyMaterial = standard(look.color, { roughness: look.roughness });
  const body = new THREE.Mesh(bodyGeometry(kind, height), bodyMaterial);
  // 어느 모양이든 중심이 절반 높이에 오면 바닥에 닿는다(공은 반지름이 곧 절반 높이다).
  body.position.y = height / 2;
  body.castShadow = true;
  pivot.add(body);

  if (bomber) {
    // 심지. **이 적의 유일한 부품이고, 방향이 아니라 성질을 말한다** —
    // 몸 한가운데 똑바로 서 있어서 어느 쪽에서 봐도 같게 보인다.
    // 끝의 불씨는 늘 켜져 있다(`bomberFuse`) — 달아오르는 것은 몸이고(Renderer),
    // 여기는 "저건 터지는 것"이라는 표지다.
    const wick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.32, 6),
      standard(PALETTE.bomberDark, { roughness: 0.4 }),
    );
    wick.position.y = height + 0.14;
    pivot.add(wick);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.bomberFuse }),
    );
    spark.position.y = height + 0.34;
    pivot.add(spark);
  } else {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(ENEMY.radius * 0.55, 10, 6),
      standard(look.cap, { roughness: 0.35 }),
    );
    cap.position.y = height + ENEMY.radius * 0.25;
    pivot.add(cap);
  }

  if (bomber) {
    // 부품 없음 — 위 주석을 보라. 정면을 가리키는 것을 달지 않는다.
  } else if (charger) {
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

  // **예고 고리. 폭탄병만 크기가 다르고, 그 크기가 곧 규칙이다.**
  // 앞의 셋에게 고리는 "나를 노린다"는 표지라 몸 둘레면 되지만(Renderer가 좁혀 온다),
  // 폭탄병의 고리는 **터질 원 그 자체**다(`BOMBER.blastRadius`). 그래서 좁히지 않고
  // 처음부터 닿는 자리를 그대로 그린다 — 그 밖으로 나가는 것이 유일한 답이기 때문이다.
  const ringOuter = bomber ? BOMBER.blastRadius : ENEMY.radius * 1.35;
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: charger
      ? PALETTE.charger
      : shield
        ? PALETTE.shield
        : bomber
          ? PALETTE.bomberFuse
          : PALETTE.enemyArrow,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const aimRing = new THREE.Mesh(
    new THREE.RingGeometry(ringOuter * (bomber ? 0.93 : 0.81), ringOuter, bomber ? 48 : 24),
    ringMaterial,
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
    ringMaterial,
    shieldPlate: plate?.pivot ?? null,
    shieldMaterial: plate?.material ?? null,
  };
}

/** 방패병의 몸 키. 방패의 자세가 이 값에서 나오므로 상수로 빼 둔다. */
const SHIELD_BODY_HEIGHT = ENEMY.height * 0.88;

/** 폭탄병의 몸 키(m). 바닥에 놓인 공이라 **지름이 곧 키**다(`bodyGeometry`). */
const BOMBER_BODY_HEIGHT = ENEMY.radius * 1.7;

/**
 * 종류별 몸의 색·머리 색·키·거칠기. **종류를 하나 더 넣을 때 손대는 자리를 한곳에 모은다** —
 * 전에는 `kind === 'charger' ? ... : kind === 'shield' ? ...`가 네 군데에 흩어져 있어서,
 * 넷째 종류를 넣으려면 그 네 줄을 전부 찾아 고쳐야 했다(하나를 빠뜨리면 새 적이
 * 조용히 활잡이의 색을 입는다).
 *
 * **모양은 여기 없다**(`bodyGeometry`). 색은 값이지만 모양은 지오메트리라 표에 담기지 않는다.
 */
const BODY_LOOK: Record<EnemyKind, { color: number; cap: number; height: number; roughness: number }> =
  {
    archer: { color: PALETTE.enemy, cap: PALETTE.enemyHit, height: ENEMY.height, roughness: 0.5 },
    charger: {
      color: PALETTE.charger,
      cap: PALETTE.chargerDark,
      height: ENEMY.height * 0.62,
      roughness: 0.35,
    },
    shield: {
      color: PALETTE.shield,
      cap: PALETTE.shieldDark,
      height: SHIELD_BODY_HEIGHT,
      roughness: 0.5,
    },
    bomber: {
      color: PALETTE.bomber,
      cap: PALETTE.bomberDark,
      height: BOMBER_BODY_HEIGHT,
      roughness: 0.45,
    },
  };

/**
 * 적 종류를 런타임에 훑을 수 있는 **하나뿐인 목록**(DESIGN 9번).
 *
 * `EnemyKind`는 타입이라 돌아가는 코드에서는 훑을 수 없고, 그렇다고 따로 적어 두면
 * 종류가 늘 때 한쪽만 고치는 날이 온다 — 실제로 왔다. 폭탄병이 들어온 뒤에도
 * `tools/enemy-shot.mjs`는 세 종류만 알고 있어서 **새 적을 찍을 방법이 없었다.**
 * 그래서 `BODY_LOOK`에서 뽑는다. 저 표는 `Record<EnemyKind, …>`라 종류를 하나 빠뜨리면
 * 타입 검사가 먼저 막는다. 목록이 그 표를 따라오므로 두 곳이 어긋날 자리가 없다.
 */
export const ENEMY_KINDS = Object.keys(BODY_LOOK) as EnemyKind[];

/** 종류별 몸의 모양. 반지름은 어느 것도 `ENEMY.radius`를 넘지 않는다(판정이 하나다). */
function bodyGeometry(kind: EnemyKind, height: number): THREE.BufferGeometry {
  if (kind === 'charger')
    return new THREE.BoxGeometry(ENEMY.radius * 1.7, height, ENEMY.radius * 1.5);
  // 바닥에 놓인 공. 각진 몸 셋 사이에서 이것만 둥글어 멀리서도 먼저 갈린다.
  if (kind === 'bomber') return new THREE.SphereGeometry(height / 2, 14, 10);
  return new THREE.CylinderGeometry(
    ENEMY.radius * (kind === 'shield' ? 0.8 : 1),
    ENEMY.radius * 0.85,
    height,
    kind === 'shield' ? 8 : 6,
  );
}

/**
 * 방패판의 크기. 몸 반지름·키에 대한 배율로 둔다 — 몸이 바뀌면 방패도 따라가야 한다.
 * **막는 각은 여기 없다.** 그것은 `SHIELD.arc` 하나뿐이고, 판은 그 값을 두르기만 한다.
 */
const SHIELD_PLATE = { radiusScale: 1.3, heightScale: 0.46 } as const;

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

const PLATE_FRESH = new THREE.Color(PALETTE.shieldDark);
const PLATE_SPENT = new THREE.Color(PALETTE.shieldSpent);
const PLATE_SPARK = new THREE.Color(PALETTE.shieldSpark);

/**
 * 방패판이 스스로 내는 빛의 세기. 둘을 더한 것이 판의 밝기다.
 *
 * **성한 만큼 빛나는 몫(`intact`)이 필요한 이유**: 판은 선 벽이라 머리 위의 해가
 * 스치기만 한다. 그래서 색만 바꿔 두면 성한 청록(`shieldDark`)과 닳은 잿빛
 * (`shieldSpent`)이 화면에서는 둘 다 그냥 어둡다 — 화면에서 재 보고 넣었다.
 *
 * **받아 낸 몫(`spark`)이 0.4인 이유**: 처음에 0.75를 흰빛으로 주었더니 판이 통째로
 * 하얘져 남은 내구도가 지워졌다. 정면으로 쏘는 내내 매 발 다시 켜지는 빛이라
 * (플레이어의 발사 간격 0.38초, 연사를 다 쌓으면 0.16초) 세게 주면
 * **번쩍임이 사건이 아니라 방패의 평소 색**이 된다.
 */
export const SHIELD_GLOW = { intact: 0.3, spark: 0.4 } as const;

/**
 * 방패판의 지금 빛깔을 재질에 옮긴다. 판이 하는 말 둘을 한 자리에서 정한다:
 * **얼마나 남았는가**(색과 밝기)와 **방금 받아 냈는가**(흰빛으로 번지는 밝기).
 *
 * 둘을 떼어 놓으면 서로를 지운다 — 그래서 한 함수에 있고, 검사가 그 관계를 지킨다
 * (`tests/models.test.ts`: 성한 판은 받아 내는 순간에도 닳은 판보다 밝다).
 *
 * **새 색을 만들지 않고 넘겨받은 재질을 고쳐 쓴다.** 매 프레임 · 적마다 불린다.
 */
export function applyShieldLook(
  material: THREE.MeshStandardMaterial,
  shieldHp: number,
  flash: number,
): void {
  const intact = Math.min(Math.max(shieldHp, 0) / SHIELD.shieldHp, 1);
  const spark = Math.min(Math.max(flash, 0), 1);
  material.color.copy(PLATE_SPENT).lerp(PLATE_FRESH, intact);
  material.emissive.copy(PLATE_FRESH).lerp(PLATE_SPARK, spark);
  material.emissiveIntensity = SHIELD_GLOW.intact * intact + SHIELD_GLOW.spark * spark;
}

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
 * 그 각도(`CAMERA_TILT`)는 `camera.ts`가 갖고 있다 — 화면을 세우는 값과 같아야 한다.
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
 * 터진 자국 (DESIGN 9번 · 폭탄병). **채워진 원 하나다.**
 *
 * 고리가 아니라 원을 채우는 이유: 예고는 고리였고(`createEnemy`의 `aimRing`),
 * 터지는 것은 그 안쪽 전부다. 같은 자리에 고리를 한 번 더 그리면 "아직 예고 중"으로
 * 읽혀, 이미 끝난 일이 다시 위협으로 보인다.
 *
 * 반지름 1로 만들어 두고 `scale`로 키운다 — 터질 원의 크기는 게임 쪽 값이라
 * (`BOMBER.blastRadius` · 파열은 그 사람의 `burstRadius`) 그리는 쪽이 따로 알 필요가 없다.
 */
export function createBlast(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({
      // 색은 세울 때 자국의 출신대로 바꿔 넣는다(`render/Renderer.ts`) — 재료를 메시마다
      // 따로 들고 있어서 풀에서 꺼내 쓸 때 덧칠할 수 있다.
      color: PALETTE.bomberFuse,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      // 바닥과 겹쳐 깜빡이지 않게 깊이 기록을 끈다(바닥 위에 얹는 그림이다).
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  // 예고 고리(0.05)보다 살짝 위에 얹는다 — 터지는 순간 둘이 함께 있는 프레임이 있다.
  mesh.position.y = 0.06;
  return mesh;
}

/**
 * 경험치 코어. 팔면체 하나로 만든다 — 아레나의 기둥·구·원기둥과 겹치지 않는
 * 유일한 형태라, 작게 그려도 "저건 주우러 가는 것"으로 읽힌다.
 * 드롭은 색을 달리해서 맵에 놓인 것보다 값지다는 것을 보여 준다.
 *
 * **드롭이 1.4배로 큰 이유**: 한 마리가 한 알을 떨군다(`CORE.drop.perKill` 1 · 값 15).
 * 셋이 한꺼번에 빨려 들어오던 자리를 한 알이 대신하므로, 그 한 알이 맵 코어(값 1)와
 * 같은 크기로 보이면 처치의 보상이 화면에서 작아진다. 1.25배였던 것을 그만큼 키웠다.
 */
export function createCore(drop: boolean): THREE.Mesh {
  const color = drop ? PALETTE.coreDrop : PALETTE.core;
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(CORE.radius * (drop ? 1.4 : 1.0)),
    // emissive를 세게 주면 모든 면이 같은 밝기가 되어 납작한 사각형으로 보인다.
    // 빛나되 면의 음영이 남을 만큼만 준다 — 그래야 각진 결정처럼 읽힌다.
    standard(color, { emissive: color, emissiveIntensity: 0.4, roughness: 0.35 }),
  );
  mesh.castShadow = false;
  return mesh;
}
