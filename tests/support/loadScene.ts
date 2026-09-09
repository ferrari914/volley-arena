import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import { ARENA } from '../../src/data/config';
import type { Vec2 } from '../../src/core/math';

/**
 * DESIGN "품질 기준"의 부하 상황 — 적 20마리 · 투사체 60개.
 * 두 숫자는 거기서 그대로 가져온다. 임의로 낮추면 재는 의미가 없다.
 */
export const LOAD_TARGETS = 20;
export const LOAD_ARROWS = 60;

/** 씨앗 고정 난수(LCG). 바퀴마다 "같은 장면"을 재야 수치를 비교할 수 있다. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 대상 20개를 두 겹의 원으로 세운다.
 * 한 겹에 몰아 두면 자동 조준이 늘 같은 하나만 보게 되어
 * 실제 전투보다 판정이 헐거워진다.
 */
export function loadSceneTargets(): Vec2[] {
  const rings = [
    { radius: 9, count: 8, phase: 0 },
    { radius: 17, count: 12, phase: Math.PI / 12 },
  ];
  const out: Vec2[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i += 1) {
      const angle = ring.phase + (i / ring.count) * Math.PI * 2;
      out.push({ x: Math.cos(angle) * ring.radius, y: Math.sin(angle) * ring.radius });
    }
  }
  return out;
}

/**
 * 부하 장면. `World.step()`이 최악에 가까운 조건에서 얼마나 걸리는지 재려고 만든다.
 *
 * 지금 게임은 화살이 0.38초에 한 발, 수명 1.6초라서 저절로는 5발 남짓밖에 못 뜬다.
 * 60발은 8번(다중 발사) 이후의 상황이므로 여기서 직접 채워 넣는다.
 */
export class LoadScene {
  readonly world: World;
  private readonly random = makeRandom(20260909);
  private step = 0;

  constructor() {
    this.world = new World({ targets: loadSceneTargets() });
  }

  get aliveTargets(): number {
    return this.world.targets.filter((t) => t.alive).length;
  }

  /**
   * 스텝 "직전"에 불러 부하를 최대치로 되돌린다.
   *
   * 대상은 맞으면 쓰러지지만 여기서는 곧바로 다시 세운다. 두 가지 이유다:
   * (1) 5번에서 적에게 체력이 붙으면 한 대 맞고 사라지지 않는다.
   * (2) 살아 있는 대상이 많을수록 충돌 검사가 무거우므로 이쪽이 불리한 쪽이다.
   *     성능은 유리한 쪽을 재면 아무것도 증명하지 못한다.
   */
  replenish(): void {
    for (const target of this.world.targets) {
      if (target.alive) continue;
      target.alive = true;
      target.pos = { x: target.home.x, y: target.home.y };
      target.respawnTimer = 0;
    }

    // 플레이어가 쏜 화살까지 세어 60개를 채운다. 넘치면 그대로 둔다 —
    // 넘친 것을 지우면 실제보다 가벼운 장면을 재게 된다.
    while (this.world.arrows.length < LOAD_ARROWS) {
      // 아레나 안쪽 아무 곳에서 아무 방향으로. 화살은 플레이어를 떠나면
      // 위치가 흩어지므로, 한 점에서 쏟아붓는 것보다 실제에 가깝다.
      const angle = this.random() * Math.PI * 2;
      const radius = Math.sqrt(this.random()) * (ARENA.radius - 2);
      const heading = this.random() * Math.PI * 2;
      this.world.addArrow(
        { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
        { x: Math.cos(heading), y: Math.sin(heading) },
      );
    }
  }

  /** 플레이어도 멈춰 있지 않다 — 이동·조준 코드까지 시간에 포함시킨다. */
  nextInput(): FrameInput {
    const angle = this.step * 0.017;
    this.step += 1;
    return { move: { x: Math.cos(angle), y: Math.sin(angle) }, aim: null };
  }
}
