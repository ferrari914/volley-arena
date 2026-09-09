import * as THREE from 'three';
import type { World } from '../core/World';
import { ARENA, ARROW, CORE, ENEMY } from '../data/config';
import type { Vec2 } from '../core/math';
import type { ArrowOwner, CoreOrigin } from '../entities/types';
import {
  createArena,
  createArrow,
  createCore,
  createEnemy,
  createLockMarker,
  createPlayer,
  CAMERA_OFFSET as CAMERA_OFFSET_SPEC,
  PALETTE,
  type EnemyView,
} from './models';

/**
 * 쿼터뷰 카메라가 플레이어로부터 떨어져 있는 거리. 1인칭도 정탑다운도 아니다.
 * 더 멀리 빼면 주변이 넓게 보이지만 작은 화면에서 플레이어가 점이 된다.
 * 값은 models.ts가 갖고 있다 — 적 머리 위 체력바가 같은 각도를 써야 하기 때문이다.
 */
const CAMERA_OFFSET = new THREE.Vector3(
  CAMERA_OFFSET_SPEC.x,
  CAMERA_OFFSET_SPEC.y,
  CAMERA_OFFSET_SPEC.z,
);
/** 픽셀 비율 상한. 3배 이상 화면에서 그대로 그리면 중급 기기가 못 버틴다. */
const MAX_PIXEL_RATIO = 2;

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly playerMesh = createPlayer();
  private readonly enemyViews: EnemyView[] = [];
  private readonly lockMarker = createLockMarker();
  /** 화살 메시. 주인을 함께 들고 있어야 회수할 때 맞는 쪽 풀로 돌려보낸다(코어와 같은 규칙). */
  private readonly arrowMeshes = new Map<number, { mesh: THREE.Group; owner: ArrowOwner }>();
  private readonly arrowPools: Record<ArrowOwner, THREE.Group[]> = { player: [], enemy: [] };
  /** 코어 메시. 출처를 함께 들고 있어야 회수할 때 맞는 쪽 풀로 돌려보낼 수 있다. */
  private readonly coreMeshes = new Map<number, { mesh: THREE.Mesh; origin: CoreOrigin }>();
  private readonly corePools: Record<CoreOrigin, THREE.Mesh[]> = { ambient: [], drop: [] };

  private readonly cameraFocus = new THREE.Vector3();
  private lastRenderTime = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x0b1020, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.Fog(0x0b1020, 40, 96);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 220);
    this.scene.add(this.camera);

    this.scene.add(createArena());
    this.scene.add(this.playerMesh);
    this.scene.add(this.lockMarker);
    this.addLights();

    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    this.resize();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x121a33, 1.15));

    const sun = new THREE.DirectionalLight(0xfff3d6, 1.5);
    sun.position.set(18, 34, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    // 그림자 카메라를 아레나에 딱 맞춘다. 넓게 잡으면 그림자가 뭉갠다.
    const shadowCam = sun.shadow.camera;
    shadowCam.left = -ARENA.radius - 4;
    shadowCam.right = ARENA.radius + 4;
    shadowCam.top = ARENA.radius + 4;
    shadowCam.bottom = -ARENA.radius - 4;
    shadowCam.near = 1;
    shadowCam.far = 90;
    shadowCam.updateProjectionMatrix();
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /** 시뮬레이션 상태를 화면에 옮긴다. 여기서 게임 상태를 바꾸지 않는다. */
  sync(world: World): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastRenderTime) / 1000, 0.1);
    this.lastRenderTime = now;

    const player = world.player;
    this.playerMesh.position.set(player.pos.x, 0, player.pos.y);
    this.playerMesh.rotation.y = yawFromAngle(player.facing);

    // 맞은 순간 잠깐 부풀렸다 돌아온다. 몸이 반응하지 않으면 맞은 줄 모른다.
    const pop = 1 + world.player.hitFlash * 0.16;
    this.playerMesh.scale.set(pop, pop, pop);

    this.syncEnemies(world);
    this.syncArrows(world);
    this.syncCores(world);
    this.syncCamera(player.pos, dt);
  }

  /**
   * 적. 수는 판 내내 바뀌지 않으므로 배열 자리로 짝짓는다.
   * 매 프레임 만지는 것은 셋이다 — 자리·체력바·겨누는 예고.
   */
  private syncEnemies(world: World): void {
    while (this.enemyViews.length < world.enemies.length) {
      const view = createEnemy();
      this.enemyViews.push(view);
      this.scene.add(view.group);
    }

    world.enemies.forEach((enemy, index) => {
      const view = this.enemyViews[index];
      if (!view) return;
      const group = view.group;
      group.visible = enemy.alive;
      if (!enemy.alive) return;

      group.position.set(enemy.pos.x, 0, enemy.pos.y);
      group.rotation.y = yawFromAngle(enemy.facing);
      // 맞는 순간 잠깐 부풀렸다 돌아온다. 명중이 화면에 보이지 않으면 쏘는 맛이 없다.
      const pop = 1 + enemy.hitFlash * 0.22;
      group.scale.set(pop, pop, pop);

      // 체력바는 한 대라도 맞은 적에게만 띄운다. 전부 띄우면 화면이 막대로 덮인다.
      const ratio = Math.max(enemy.hp, 0) / enemy.maxHp;
      view.hpBar.visible = ratio < 1;
      view.hpFill.scale.x = ratio;

      // 겨누는 동안: 몸이 달아오르고 발밑 고리가 좁혀진다.
      // 여기가 이 게임에서 유일한 "지금 나를 노리고 있다"는 예고다.
      const aiming = enemy.aimTimer > 0;
      view.aimRing.visible = aiming;
      if (aiming) {
        const charge = 1 - enemy.aimTimer / ENEMY.aimTime;
        view.aimRing.scale.setScalar(2.1 - charge * 1.1);
        view.bodyMaterial.emissive.setHex(PALETTE.enemyArrow);
        view.bodyMaterial.emissiveIntensity = 0.15 + charge * 0.5;
      } else if (enemy.hitFlash > 0) {
        view.bodyMaterial.emissive.setHex(PALETTE.enemyHit);
        view.bodyMaterial.emissiveIntensity = enemy.hitFlash * 0.8;
      } else {
        view.bodyMaterial.emissiveIntensity = 0;
      }
    });

    const locked = world.lockedEnemy;
    this.lockMarker.visible = locked !== null && locked.alive;
    if (locked) {
      this.lockMarker.position.set(locked.pos.x, 0.04, locked.pos.y);
      this.lockMarker.rotation.z += 0.02;
    }
  }

  private syncArrows(world: World): void {
    const seen = new Set<number>();
    for (const arrow of world.arrows) {
      seen.add(arrow.id);
      let entry = this.arrowMeshes.get(arrow.id);
      if (!entry) {
        const mesh = this.arrowPools[arrow.owner].pop() ?? createArrow(arrow.owner);
        mesh.visible = true;
        this.scene.add(mesh);
        entry = { mesh, owner: arrow.owner };
        this.arrowMeshes.set(arrow.id, entry);
      }
      entry.mesh.position.set(arrow.pos.x, ARROW.height, arrow.pos.y);
      entry.mesh.rotation.y = yawFromAngle(Math.atan2(arrow.vel.y, arrow.vel.x));
    }

    for (const [id, entry] of this.arrowMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.mesh);
      entry.mesh.visible = false;
      this.arrowMeshes.delete(id);
      // 새 화살은 초당 여러 발 나간다. 매번 새로 만들면 GC가 프레임을 튀게 한다.
      this.arrowPools[entry.owner].push(entry.mesh);
    }
  }

  /**
   * 경험치 코어. 화살과 같은 풀 방식이다 — 난전에서는 초당 여러 개가 생겼다 사라지므로
   * 매번 새로 만들면 GC가 프레임을 튀게 한다.
   */
  private syncCores(world: World): void {
    const seen = new Set<number>();
    for (const core of world.cores) {
      seen.add(core.id);
      let entry = this.coreMeshes.get(core.id);
      if (!entry) {
        const mesh = this.corePools[core.origin].pop() ?? createCore(core.origin === 'drop');
        mesh.visible = true;
        mesh.rotation.set(0.42, core.id * 0.7, 0);
        this.scene.add(mesh);
        entry = { mesh, origin: core.origin };
        this.coreMeshes.set(core.id, entry);
      }
      const mesh = entry.mesh;
      // 바닥에서 살짝 떠서 위아래로 흔들린다. 붙어 있으면 격자에 묻혀 보이지 않는다.
      const bob = CORE.radius + 0.5 + Math.sin(core.age * 3.4 + core.id) * 0.13;
      mesh.position.set(core.pos.x, bob, core.pos.y);
      mesh.rotation.y += 0.035;

      // 생길 때 커지고, 사라지기 3초 전부터 깜빡인다.
      // 투명도 대신 크기로 알린다 — 반투명은 정렬 비용이 붙고 작은 화면에서 잘 안 보인다.
      let scale = Math.min(1, core.age * 5);
      if (core.ttl < 3) scale *= 0.72 + 0.28 * Math.sin(core.ttl * 17);
      mesh.scale.setScalar(scale);
    }

    for (const [id, entry] of this.coreMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.mesh);
      entry.mesh.visible = false;
      this.coreMeshes.delete(id);
      this.corePools[entry.origin].push(entry.mesh);
    }
  }

  private syncCamera(playerPos: Vec2, dt: number): void {
    // 프레임 수와 무관하게 같은 속도로 따라붙는다.
    const follow = 1 - Math.exp(-9 * dt);
    this.cameraFocus.lerp(new THREE.Vector3(playerPos.x, 0, playerPos.y), follow);
    this.camera.position.set(
      this.cameraFocus.x + CAMERA_OFFSET.x,
      CAMERA_OFFSET.y,
      this.cameraFocus.z + CAMERA_OFFSET.z,
    );
    this.camera.lookAt(this.cameraFocus);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 화면의 한 점이 바닥면 어디인지. 마우스 조준에 쓴다. */
  screenToGround(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    return { x: point.x, y: point.z };
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.renderer.dispose();
  }
}

/**
 * 게임의 각도(방향 벡터가 (cos, sin) = (x, z))를 Three.js의 Y축 회전으로.
 * Three.js 오브젝트의 정면은 -Z다.
 */
export function yawFromAngle(angle: number): number {
  return Math.atan2(-Math.cos(angle), -Math.sin(angle));
}
