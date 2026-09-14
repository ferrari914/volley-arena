import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import { ARENA } from '../../src/data/config';
import type { Vec2 } from '../../src/core/math';

/**
 * DESIGN "품질 기준"의 부하 상황 — 적 20마리 · 투사체 60개.
 * 두 숫자는 거기서 그대로 가져온다. 임의로 낮추면 재는 의미가 없다.
 */
export const LOAD_ENEMIES = 20;
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
 * 적 20마리를 두 겹의 원으로 세운다.
 * 한 겹에 몰아 두면 자동 조준이 늘 같은 하나만 보게 되어
 * 실제 전투보다 판정이 헐거워진다.
 */
export function loadSceneEnemies(): Vec2[] {
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
    this.world = new World({ enemies: loadSceneEnemies() });
  }

  get aliveEnemies(): number {
    return this.world.enemies.filter((enemy) => enemy.alive).length;
  }

  /**
   * 스텝 "직전"에 불러 부하를 최대치로 되돌린다.
   *
   * 적은 맞으면 쓰러지지만 여기서는 곧바로 다시 세운다. 살아 있는 적이 많을수록
   * 충돌 검사도 AI도 무거우므로 이쪽이 불리한 쪽이다.
   * 성능은 유리한 쪽을 재면 아무것도 증명하지 못한다.
   *
   * 플레이어의 체력도 함께 되돌린다. 적 20마리가 동시에 쏘면 부하 장면의 플레이어는
   * 금방 쓰러지고, 쓰러진 World의 `step()`은 빈 함수가 되어 "아무것도 재지 않은 0ms"가
   * 나온다(`npm run perf`가 그 상태를 잡도록 되어 있다).
   */
  replenish(): void {
    // 카드가 떠 있으면 골라서 내린다(4번). 그냥 두면 World가 멈춰 있어
    // 이어지는 측정이 "아무 일도 하지 않는 step()"을 재고 빠르다고 말한다.
    // 실제로 하는 사람도 카드를 골라야 게임이 다시 흐르므로 이쪽이 실제에 가깝다.
    const offered = this.world.offer?.choices[0];
    if (offered) this.world.chooseUpgrade(offered.card.id);

    this.world.player.hp = this.world.player.maxHp;

    for (const enemy of this.world.enemies) {
      if (enemy.alive) continue;
      enemy.alive = true;
      enemy.hp = enemy.maxHp;
      enemy.pos = { x: enemy.standAt.x, y: enemy.standAt.y };
      enemy.respawnTimer = 0;
      enemy.aimTimer = 0;
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
