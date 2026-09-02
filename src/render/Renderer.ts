import * as THREE from 'three';
import type { World } from '../core/World';
import { ARENA, ARROW } from '../data/config';
import type { Vec2 } from '../core/math';
import {
  createArena,
  createArrow,
  createLockMarker,
  createPlayer,
  createTarget,
} from './models';

/**
 * 쿼터뷰 카메라가 플레이어로부터 떨어져 있는 거리. 1인칭도 정탑다운도 아니다.
 * 더 멀리 빼면 주변이 넓게 보이지만 작은 화면에서 플레이어가 점이 된다.
 */
const CAMERA_OFFSET = new THREE.Vector3(0, 15.5, 12.5);
/** 픽셀 비율 상한. 3배 이상 화면에서 그대로 그리면 중급 기기가 못 버틴다. */
const MAX_PIXEL_RATIO = 2;

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly playerMesh = createPlayer();
  private readonly targetMeshes: THREE.Group[] = [];
  private readonly lockMarker = createLockMarker();
  private readonly arrowMeshes = new Map<number, THREE.Group>();
  private readonly arrowPool: THREE.Group[] = [];

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

    this.syncTargets(world);
    this.syncArrows(world);
    this.syncCamera(player.pos, dt);
  }

  private syncTargets(world: World): void {
    while (this.targetMeshes.length < world.targets.length) {
      const mesh = createTarget();
      this.targetMeshes.push(mesh);
      this.scene.add(mesh);
    }
    world.targets.forEach((target, index) => {
      const mesh = this.targetMeshes[index];
      if (!mesh) return;
      mesh.visible = target.alive;
      mesh.position.set(target.pos.x, 0, target.pos.y);
      // 맞는 순간 잠깐 부풀렸다 돌아온다. 명중이 화면에 보이지 않으면 쏘는 맛이 없다.
      const pop = 1 + target.hitFlash * 0.28;
      mesh.scale.set(pop, pop, pop);
    });

    const locked = world.lockedTarget;
    this.lockMarker.visible = locked !== null;
    if (locked) {
      this.lockMarker.position.set(locked.pos.x, 0.04, locked.pos.y);
      this.lockMarker.rotation.z += 0.02;
    }
  }

  private syncArrows(world: World): void {
    const seen = new Set<number>();
    for (const arrow of world.arrows) {
      seen.add(arrow.id);
      let mesh = this.arrowMeshes.get(arrow.id);
      if (!mesh) {
        mesh = this.arrowPool.pop() ?? createArrow();
        mesh.visible = true;
        this.scene.add(mesh);
        this.arrowMeshes.set(arrow.id, mesh);
      }
      mesh.position.set(arrow.pos.x, ARROW.height, arrow.pos.y);
      mesh.rotation.y = yawFromAngle(Math.atan2(arrow.vel.y, arrow.vel.x));
    }

    for (const [id, mesh] of this.arrowMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      mesh.visible = false;
      this.arrowMeshes.delete(id);
      // 새 화살은 초당 여러 발 나간다. 매번 새로 만들면 GC가 프레임을 튀게 한다.
      this.arrowPool.push(mesh);
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
