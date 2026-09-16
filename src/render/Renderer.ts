import * as THREE from 'three';
import type { World } from '../core/World';
import { ARENA, ARROW, BOMBER, CHARGER, CORE, ENEMY, SHIELD } from '../data/config';
import type { ArenaMap } from '../data/maps';
import type { Vec2 } from '../core/math';
import type { ArrowOwner, CoreOrigin, Enemy } from '../entities/types';
import {
  applyShieldLook,
  createArena,
  createBlast,
  createObstacles,
  createArrow,
  createCore,
  createEnemy,
  createLockMarker,
  createPlayer,
  PALETTE,
  SHIELD_POSE,
  type EnemyView,
} from './models';
import { cameraFocusFor, createGameCamera, placeCamera } from './camera';

/** 픽셀 비율 상한. 3배 이상 화면에서 그대로 그리면 중급 기기가 못 버틴다. */
const MAX_PIXEL_RATIO = 2;

/**
 * 방패가 내려가고 올라오는 빠르기(1/s · 지수 감쇠). **내리는 쪽이 더 빠르다.**
 * 내려간 동안이 정면이 열리는 유일한 창이라(`SHIELD.aimTime` 0.7초), 창이 열리는 것은
 * 창보다 빨리 보여야 한다 — 느리게 내려가면 다 내려갔을 때 이미 화살이 날아온 뒤다.
 * 12로 두면 0.25초에 9할이 내려간다. 올라오는 것은 급할 것이 없어 절반 빠르기다.
 */
const SHIELD_LOWER_RATE = 12;
const SHIELD_RAISE_RATE = 6;
/** 성한 방패의 색과 다 닳은 방패의 색. 사이를 남은 내구도로 오간다. */

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly playerView = createPlayer();
  private readonly enemyViews: EnemyView[] = [];
  private readonly lockMarker = createLockMarker();
  /** 화살 메시. 주인을 함께 들고 있어야 회수할 때 맞는 쪽 풀로 돌려보낸다(코어와 같은 규칙). */
  private readonly arrowMeshes = new Map<number, { mesh: THREE.Group; owner: ArrowOwner }>();
  private readonly arrowPools: Record<ArrowOwner, THREE.Group[]> = { player: [], enemy: [] };
  /** 코어 메시. 출처를 함께 들고 있어야 회수할 때 맞는 쪽 풀로 돌려보낼 수 있다. */
  private readonly coreMeshes = new Map<number, { mesh: THREE.Mesh; origin: CoreOrigin }>();
  private readonly corePools: Record<CoreOrigin, THREE.Mesh[]> = { ambient: [], drop: [] };
  /** 터진 자국(DESIGN 9번 · 폭탄병). 화살·코어와 같은 풀 방식이다. */
  private readonly blastMeshes = new Map<number, THREE.Mesh>();
  private readonly blastPool: THREE.Mesh[] = [];

  /** 지금 세워 둔 기둥들(DESIGN 10번). 맵이 바뀌면 통째로 갈아 끼운다. */
  private obstacleGroup: THREE.Group | null = null;
  private readonly cameraFocus = new THREE.Vector3();
  /** `syncCamera`가 매 프레임 쓰는 임시 자리. 프레임마다 새로 만들지 않으려고 둔다. */
  private readonly focusTarget = new THREE.Vector3();
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

    this.camera = createGameCamera();
    this.scene.add(this.camera);

    this.scene.add(createArena());
    this.scene.add(this.playerView.group);
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
    const body = this.playerView.group;
    body.position.set(player.pos.x, 0, player.pos.y);
    body.rotation.y = yawFromAngle(player.facing);

    // 맞은 순간 잠깐 부풀렸다 돌아온다. 몸이 반응하지 않으면 맞은 줄 모른다.
    const pop = 1 + world.player.hitFlash * 0.16;
    body.scale.set(pop, pop, pop);

    // 무적인 동안에는 보호막이 감싼다(부활 직후 3초 · 맞은 직후 0.55초).
    // 숨 쉬듯 두께가 변한다 — 멈춰 있는 껍질은 화면에 붙은 얼룩처럼 보인다.
    this.playerView.shield.visible = player.invulnerable > 0;
    if (player.invulnerable > 0) {
      this.playerView.shieldMaterial.opacity = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(now * 0.011));
    }

    this.syncEnemies(world, dt);
    this.syncArrows(world);
    this.syncCores(world);
    this.syncBlasts(world);
    this.syncCamera(player.pos, dt);
  }

  /**
   * 적. 수는 판 내내 바뀌지 않으므로 배열 자리로 짝짓는다.
   * 매 프레임 만지는 것은 셋이다 — 자리·체력바·겨누는 예고.
   */
  private syncEnemies(world: World, dt: number): void {
    while (this.enemyViews.length < world.enemies.length) {
      // 모델은 종류마다 다르다(DESIGN 9번). 자리로 짝지으므로 그 자리의 적을 보고 만든다 —
      // 적의 종류는 판이 끝날 때까지 바뀌지 않는다.
      const view = createEnemy(world.enemies[this.enemyViews.length]?.kind);
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
      // 도는 것은 몸통뿐이다. 바깥 묶음을 돌리면 체력바까지 함께 돌아 등을 보인다.
      view.pivot.rotation.y = yawFromAngle(enemy.facing);
      // 맞는 순간 잠깐 부풀렸다 돌아온다. 명중이 화면에 보이지 않으면 쏘는 맛이 없다.
      const pop = 1 + enemy.hitFlash * 0.22;
      group.scale.set(pop, pop, pop);

      // 체력바는 한 대라도 맞은 적에게만 띄운다. 전부 띄우면 화면이 막대로 덮인다.
      const ratio = Math.max(enemy.hp, 0) / enemy.maxHp;
      view.hpBar.visible = ratio < 1;
      view.hpFill.scale.x = ratio;

      // 겨누는(돌진형은 웅크리는) 동안: 몸이 달아오르고 발밑 고리가 좁혀진다.
      // 여기가 이 게임에서 유일한 "지금 나를 노리고 있다"는 예고다.
      // 두 종류가 같은 예고를 쓰므로 처음 하는 사람이 한 번만 배우면 된다.
      const charger = enemy.kind === 'charger';
      const shield = enemy.kind === 'shield';
      const bomber = enemy.kind === 'bomber';
      const aiming = enemy.aimTimer > 0;
      const dashing = enemy.dashTimer > 0;
      view.aimRing.visible = aiming;
      if (aiming && bomber) {
        // **폭탄병의 고리는 좁혀지지 않는다.** 그 원이 곧 닿는 자리라(`BOMBER.blastRadius`),
        // 크기를 흔들면 어디까지 나가야 하는지를 화면이 거짓으로 말한다.
        // 남은 시간은 대신 **깜빡임**이 말한다 — 세 번 깜빡이면 터진다.
        const charge = 1 - enemy.aimTimer / BOMBER.fuse;
        view.ringMaterial.opacity = 0.35 + 0.55 * Math.abs(Math.sin(charge * Math.PI * 3));
        view.bodyMaterial.emissive.setHex(PALETTE.bomberFuse);
        view.bodyMaterial.emissiveIntensity = 0.2 + charge * 0.9;
      } else if (aiming) {
        const aimTime = charger ? CHARGER.windup : shield ? SHIELD.aimTime : ENEMY.aimTime;
        const charge = 1 - enemy.aimTimer / aimTime;
        view.aimRing.scale.setScalar(2.1 - charge * 1.1);
        view.bodyMaterial.emissive.setHex(
          charger ? PALETTE.charger : shield ? PALETTE.shield : PALETTE.enemyArrow,
        );
        view.bodyMaterial.emissiveIntensity = 0.15 + charge * 0.5;
      } else if (dashing) {
        // 몸을 던지는 동안에는 계속 밝다. 여기서 꺼 두면 가장 위험한 순간에
        // 화면에서 가장 조용한 적이 된다.
        view.bodyMaterial.emissive.setHex(PALETTE.charger);
        view.bodyMaterial.emissiveIntensity = 0.85;
      } else if (enemy.hitFlash > 0) {
        // 세게 주면 몸 전체가 하얗게 떠서 다른 종류의 적처럼 보인다(스크린샷에서 잡았다).
        // 크기가 함께 튀므로 밝기는 거들기만 하면 된다.
        view.bodyMaterial.emissive.setHex(PALETTE.enemyHit);
        view.bodyMaterial.emissiveIntensity = enemy.hitFlash * 0.3;
      } else {
        view.bodyMaterial.emissiveIntensity = 0;
      }

      this.syncShield(view, enemy, aiming, dt);
    });

    const locked = world.lockedEnemy;
    this.lockMarker.visible = locked !== null && locked.alive;
    if (locked) {
      this.lockMarker.position.set(locked.pos.x, 0.04, locked.pos.y);
      this.lockMarker.rotation.z += 0.02;
    }
  }

  /**
   * 방패병의 판 (DESIGN 9번). 판이 화면에서 하는 말은 셋이고, 셋 다 규칙 그대로다:
   *
   * 1. **겨누는 동안 내려간다** — `blocksArrow`가 `aimTimer > 0`이면 막지 않는다.
   *    그 창이 화면에 보이지 않으면 이 적은 그냥 "가끔 안 죽는 적"이 된다.
   *    한 프레임에 옮기지 않고 사이를 오가는 이유: 뚝 끊기면 방패가 사라졌다 나타난 것으로
   *    보여서 "지금 내려가는 중"이라는 예고가 되지 못한다.
   * 2. **닳으면 흐려진다** — 남은 내구도가 판의 색이다. 방패에 맞는 동안 몸 체력바는
   *    꿈쩍도 하지 않으므로(맞는 것이 몸이 아니다), 여기가 아니면 진척을 볼 곳이 없다.
   * 3. **받아 낸 순간 번쩍인다**(`shieldFlash`) — 몸이 아니라 판만 밝아진다.
   *    몸이 번쩍이면 "맞혔다"로 읽혀 정면 사격을 계속하게 된다.
   *
   * 다 부서지면 통째로 숨긴다. 다시 서는 순간 방패도 함께 돌아온다(`shieldHp`).
   */
  private syncShield(view: EnemyView, enemy: Enemy, aiming: boolean, dt: number): void {
    const plate = view.shieldPlate;
    const material = view.shieldMaterial;
    if (!plate || !material) return;

    plate.visible = enemy.shieldHp > 0;
    if (!plate.visible) return;

    const rate = aiming ? SHIELD_LOWER_RATE : SHIELD_RAISE_RATE;
    const blend = 1 - Math.exp(-rate * dt);
    const targetY = aiming ? SHIELD_POSE.loweredY : SHIELD_POSE.raisedY;
    const targetTilt = aiming ? SHIELD_POSE.loweredTilt : SHIELD_POSE.raisedTilt;
    plate.position.y += (targetY - plate.position.y) * blend;
    plate.rotation.x += (targetTilt - plate.rotation.x) * blend;

    // 판의 빛깔(남은 내구도 · 방금 받아 냈는가)은 `models.ts`가 정한다 —
    // 색을 여기서 따로 만들면 모델과 화면이 서로 다른 말을 하게 된다.
    applyShieldLook(material, enemy.shieldHp, enemy.shieldFlash);
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

  /**
   * 터진 자국 (DESIGN 9번 · 폭탄병 / DESIGN 8번 · 파열 카드). 코어·화살과 같은 풀 방식이다.
   *
   * **원의 크기는 처음부터 끝까지 터진 원 그대로다**(`blast.radius`). 퍼져 나가게 하면
   * 자국이 실제로 닿은 곳보다 넓어져서, 원 밖에 서 있던 사람이 "맞을 뻔했다"고 읽는다.
   * 사라지는 것은 크기가 아니라 **투명도**다.
   *
   * **색은 자국의 출신이 정한다**(`blast.kind`). 폭탄병의 자국은 호박빛(위험), 파열의
   * 자국은 찬 흰빛(내가 번 자리)이다 — 크기도 모양도 같아서 갈리는 것은 색뿐이다.
   * 풀에서 꺼낸 메시에는 앞서 쓰던 색이 남아 있으므로 **세울 때마다 덧칠한다.**
   * 흐려지는 속도도 자국마다 다르다(`blast.life`) — 파열은 처치마다 터져서 더 짧다.
   */
  private syncBlasts(world: World): void {
    const seen = new Set<number>();
    for (const blast of world.blasts) {
      seen.add(blast.id);
      let mesh = this.blastMeshes.get(blast.id);
      if (!mesh) {
        mesh = this.blastPool.pop() ?? createBlast();
        mesh.visible = true;
        mesh.position.set(blast.pos.x, 0.06, blast.pos.y);
        mesh.scale.setScalar(blast.radius);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(
          blast.kind === 'burst' ? PALETTE.burst : PALETTE.bomberFuse,
        );
        this.scene.add(mesh);
        this.blastMeshes.set(blast.id, mesh);
      }
      const left = 1 - Math.min(blast.age / blast.life, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.62 * left;
    }

    for (const [id, mesh] of this.blastMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      mesh.visible = false;
      this.blastMeshes.delete(id);
      this.blastPool.push(mesh);
    }
  }

  private syncCamera(playerPos: Vec2, dt: number): void {
    // 프레임 수와 무관하게 같은 속도로 따라붙는다.
    const follow = 1 - Math.exp(-9 * dt);
    this.cameraFocus.lerp(cameraFocusFor(playerPos, this.focusTarget), follow);
    placeCamera(this.camera, this.cameraFocus);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 이 맵의 기둥을 세운다 (DESIGN 10번). 맵을 고를 때와 판을 새로 만들 때 부른다.
   *
   * **지오메트리를 반드시 버린다**(`dispose`). 맵을 오갈 때마다 새로 만들어 쌓으면
   * 화면에는 안 보이는 채로 GPU 메모리만 는다 — 모바일에서 가장 먼저 무너지는 자리다.
   */
  setMap(map: ArenaMap): void {
    if (this.obstacleGroup) {
      this.scene.remove(this.obstacleGroup);
      this.obstacleGroup.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
    }
    this.obstacleGroup = createObstacles(map.obstacles);
    this.scene.add(this.obstacleGroup);
  }

  /**
   * 판을 처음부터 다시 시작할 때 화면을 비운다 — DESIGN 6번의 "리스폰".
   *
   * **World를 새 것으로 갈아 끼울 때 반드시 함께 부른다.** 화살과 코어의 메시는 번호로
   * 짝지어져 있는데(`arrowMeshes`·`coreMeshes`), 새 World는 번호를 1번부터 다시 매긴다.
   * 비우지 않으면 지난 판에 아직 회수되지 않은 메시가 새 판의 화살 자리에 눌러앉아,
   * 있지도 않은 화살이 허공에 멈춘 채로 남는다.
   * (적의 메시는 배열 자리로 짝짓고 있어서 이 문제가 없다 — 그래도 수가 줄 수 있으므로 숨긴다.)
   */
  reset(world: World): void {
    this.setMap(world.map);
    for (const entry of this.arrowMeshes.values()) {
      this.scene.remove(entry.mesh);
      entry.mesh.visible = false;
      this.arrowPools[entry.owner].push(entry.mesh);
    }
    this.arrowMeshes.clear();

    for (const entry of this.coreMeshes.values()) {
      this.scene.remove(entry.mesh);
      entry.mesh.visible = false;
      this.corePools[entry.origin].push(entry.mesh);
    }
    this.coreMeshes.clear();

    for (const view of this.enemyViews) view.group.visible = false;
    this.lockMarker.visible = false;

    // 카메라는 새 플레이어 자리로 즉시 옮긴다. 부드럽게 따라가게 두면
    // 판이 시작하자마자 화면이 지난 판의 마지막 자리에서 미끄러져 온다.
    this.cameraFocus.copy(cameraFocusFor(world.player.pos));
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
