import { describe, expect, it } from 'vitest';
import { backstepBoost, movePlayer } from '../src/systems/movement';
import { findNearestEnemy } from '../src/systems/autoAim';
import { stepArrows } from '../src/systems/combat';
import { segmentPointDistanceSq } from '../src/core/math';
import { createEnemy, createPlayer, type Arrow, type ArrowOwner } from '../src/entities/types';
import { ARROW, BOMBER, CHARGER, ENEMY, PLAYER, SHIELD } from '../src/data/config';

let nextId = 1;
const enemyAt = (x: number, y: number): ReturnType<typeof createEnemy> =>
  createEnemy(nextId++, x, y, ENEMY.maxHp);

const arrow = (
  x: number,
  y: number,
  vx: number,
  vy: number,
  owner: ArrowOwner = 'player',
  damage = 1,
  pierce = 0,
  bounce = 0,
  knockback = 0,
  pointBlank = 0,
): Arrow => ({
  id: 1,
  owner,
  pos: { x, y },
  vel: { x: vx, y: vy },
  damage,
  age: 0,
  lifetime: 1.6,
  pierce,
  bounce,
  knockback,
  pointBlank,
  alive: true,
});

/** 화살만 따로 보고 싶을 때의 기본 판. 플레이어와 적은 부르는 쪽이 채운다. */
function options(overrides: Partial<Parameters<typeof stepArrows>[1]> = {}) {
  return {
    dt: 1 / 60,
    arenaRadius: 26,
    arrowRadius: 0.16,
    enemyRadius: ENEMY.radius,
    playerRadius: PLAYER.radius,
    invulnerable: PLAYER.invulnerable,
    respawnDelay: ENEMY.respawnDelay,
    bounceRange: ARROW.bounceRange,
    pointBlankRange: ARROW.pointBlankRange,
    shieldArc: SHIELD.arc,
    obstacles: [],
    player: createPlayer(PLAYER.maxHp),
    enemies: [],
    ...overrides,
  };
}

describe('movePlayer', () => {
  it('아레나 밖으로 나가지 못한다', () => {
    const next = movePlayer({ x: 25.8, y: 0 }, { x: 1, y: 0 }, 1, 20, 26, 0.55);
    expect(Math.hypot(next.x, next.y)).toBeLessThanOrEqual(26 - 0.55 + 1e-6);
  });

  it('벽에 붙어 옆으로 밀면 미끄러지며 계속 움직인다', () => {
    const start = { x: 25.4, y: 0 };
    const next = movePlayer(start, { x: 1, y: 1 }, 1 / 60, 7.2, 26, 0.55);
    expect(next.y).toBeGreaterThan(start.y);
  });
});

/**
 * DESIGN 8번 열째 카드 — 뒷걸음(`backstep`).
 *
 * **이 게임에서 "언제"를 묻는 첫 값이다.** 나머지 능력치는 읽으면 그만이지만 이것은
 * 그 프레임의 이동 방향이 얼마나 듣는지를 정한다. 그래서 한 프레임의 규칙을 여기서 못 박는다 —
 * 무엇이 기준인가(겨눈 쪽) · 어떻게 차오르는가(각) · 언제 아무 일도 없는가.
 */
describe('backstepBoost', () => {
  /** 겨눈 쪽은 +x. 화면에서 몸이 오른쪽을 보고 서 있는 것과 같다. */
  const FACING = 0;

  it('정확히 뒤로 가면 그만큼 다 붙는다', () => {
    expect(backstepBoost({ x: -1, y: 0 }, FACING, 0.25)).toBeCloseTo(1.25, 6);
    expect(backstepBoost({ x: -1, y: 0 }, FACING, 0.5)).toBeCloseTo(1.5, 6);
  });

  it('겨눈 쪽으로 파고들 때는 아무것도 붙지 않는다', () => {
    expect(backstepBoost({ x: 1, y: 0 }, FACING, 0.25)).toBe(1);
  });

  it('옆으로 갈 때도 붙지 않는다 — 도는 것은 물러나는 것이 아니다', () => {
    expect(backstepBoost({ x: 0, y: 1 }, FACING, 0.25)).toBeCloseTo(1, 6);
    expect(backstepBoost({ x: 0, y: -1 }, FACING, 0.25)).toBeCloseTo(1, 6);
  });

  it('각으로 차오른다 — 90도에서 끊기지 않는다', () => {
    // 뒤쪽으로 45도만 돌아선 자리. 딱 끊는 자였다면 여기가 1이거나 1.25다.
    const half = backstepBoost({ x: -1, y: 1 }, FACING, 0.25);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(1.25);
    expect(half).toBeCloseTo(1 + 0.25 * Math.SQRT1_2, 6);
    // 옆(1)에서 뒤(1.25)까지 한 칸도 되돌아가지 않는다.
    const steps = Array.from({ length: 33 }, (_, i) => {
      const angle = Math.PI / 2 + (i / 32) * (Math.PI / 2);
      return backstepBoost({ x: Math.cos(angle), y: Math.sin(angle) }, FACING, 0.25);
    });
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]! - 1e-9);
    }
  });

  it('스틱을 살짝만 기울여도 방향이 같으면 같은 몫이다', () => {
    // 길이는 걷는 속도에 실린다(`movePlayer`). 여기서 보는 것은 방향뿐이다.
    expect(backstepBoost({ x: -0.2, y: 0 }, FACING, 0.25)).toBeCloseTo(1.25, 6);
  });

  it('카드가 없거나 서 있으면 곱하지 않는다', () => {
    expect(backstepBoost({ x: -1, y: 0 }, FACING, 0)).toBe(1);
    expect(backstepBoost({ x: 0, y: 0 }, FACING, 0.25)).toBe(1);
  });

  it('기준은 겨눈 쪽이다 — 몸이 돌면 같은 걸음이 다른 몫이 된다', () => {
    const move = { x: -1, y: 0 };
    expect(backstepBoost(move, 0, 0.25)).toBeCloseTo(1.25, 6);
    // 오른쪽 스틱으로 반대쪽을 겨눈 사람. 같은 방향으로 걷는데 아무것도 안 붙는다.
    expect(backstepBoost(move, Math.PI, 0.25)).toBe(1);
  });
});

describe('findNearestEnemy', () => {
  it('사거리 안에서 가장 가까운 것을 고른다', () => {
    const near = enemyAt(3, 0);
    const far = enemyAt(10, 0);
    expect(findNearestEnemy({ x: 0, y: 0 }, [far, near], 22)).toBe(near);
  });

  it('쓰러진 적은 고르지 않는다', () => {
    const near = enemyAt(3, 0);
    near.alive = false;
    const far = enemyAt(10, 0);
    expect(findNearestEnemy({ x: 0, y: 0 }, [near, far], 22)).toBe(far);
  });

  it('사거리 밖이면 null', () => {
    expect(findNearestEnemy({ x: 0, y: 0 }, [enemyAt(30, 0)], 22)).toBeNull();
  });
});

describe('segmentPointDistanceSq', () => {
  it('선분 위를 지나가면 거리 0', () => {
    expect(segmentPointDistanceSq({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0);
  });

  it('선분 끝을 넘어선 점은 끝점까지의 거리로 잰다', () => {
    expect(segmentPointDistanceSq({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBeCloseTo(4);
  });
});

describe('stepArrows', () => {
  it('한 스텝에 적을 지나쳐 버려도 명중으로 잡는다 (터널링 방지)', () => {
    const enemy = enemyAt(0.4, 0);
    // 한 프레임 이동 거리(2)가 적의 지름보다 크다. 위치만 비교하면 놓친다.
    const result = stepArrows([arrow(-1, 0, 120, 0)], options({ enemies: [enemy] }));
    expect(result.hits).toBe(1);
    expect(enemy.hp).toBe(ENEMY.maxHp - 1);
  });

  it('체력을 다 깎아야 쓰러지고, 그때만 쓰러진 적을 돌려준다', () => {
    const enemy = enemyAt(0.4, 0);
    let result = stepArrows([arrow(-1, 0, 120, 0)], options({ enemies: [enemy] }));
    expect(result.killed).toHaveLength(0);
    expect(enemy.alive).toBe(true);

    for (let i = 1; i < ENEMY.maxHp; i += 1) {
      result = stepArrows([arrow(-1, 0, 120, 0)], options({ enemies: [enemy] }));
    }
    expect(enemy.alive).toBe(false);
    // 코어가 떨어질 자리(3번)와 다시 설 자리를 정하는 쪽이 적 자신을 받아야 한다.
    expect(result.killed).toEqual([enemy]);
    expect(enemy.respawnTimer).toBe(ENEMY.respawnDelay);
  });

  it('플레이어의 화살은 플레이어를 맞히지 않는다', () => {
    const player = createPlayer(PLAYER.maxHp);
    const result = stepArrows([arrow(-1, 0, 120, 0)], options({ player }));
    expect(result.damageTaken).toBe(0);
    expect(player.hp).toBe(PLAYER.maxHp);
  });

  it('적의 화살은 적을 맞히지 않고 플레이어만 깎는다', () => {
    const player = createPlayer(PLAYER.maxHp);
    const enemy = enemyAt(0.4, 0);
    const result = stepArrows(
      [arrow(-1, 0, 120, 0, 'enemy', 7)],
      options({ player, enemies: [enemy] }),
    );
    expect(enemy.hp).toBe(ENEMY.maxHp);
    expect(result.damageTaken).toBe(7);
    // 피해량과 발 수를 따로 센다 — 카드가 자라면 한 대의 크기가 달라지므로,
    // 피하기를 재는 쪽(`밸런스 — 피하기`)은 몇 발을 맞았는가만 본다.
    expect(result.playerHits).toBe(1);
    expect(player.hp).toBe(PLAYER.maxHp - 7);
  });

  it('무적인 동안에는 적의 화살이 그냥 지나간다', () => {
    const player = createPlayer(PLAYER.maxHp);
    stepArrows([arrow(-1, 0, 120, 0, 'enemy', 7)], options({ player }));
    expect(player.invulnerable).toBe(PLAYER.invulnerable);

    // 같은 순간에 두 번째 화살이 꽂혀도 체력은 한 번만 깎인다.
    const second = arrow(-1, 0, 120, 0, 'enemy', 7);
    const result = stepArrows([second], options({ player }));
    expect(result.damageTaken).toBe(0);
    // 그냥 지나간 화살은 맞은 것이 아니다. 여기를 세면 서 있는 사람의 피격률이
    // 무적에 막힌 몫만큼 부풀어, 피하기를 재는 자가 거짓으로 커진다.
    expect(result.playerHits).toBe(0);
    expect(player.hp).toBe(PLAYER.maxHp - 7);
    expect(second.alive).toBe(true);
  });

  it('아레나 밖으로 나가면 사라진다', () => {
    const flying = arrow(25.9, 0, 120, 0);
    stepArrows([flying], options());
    expect(flying.alive).toBe(false);
  });

  it('수명이 다하면 사라진다', () => {
    const flying = arrow(0, 0, 0, 0);
    for (let i = 0; i < 200 && flying.alive; i += 1) stepArrows([flying], options());
    expect(flying.alive).toBe(false);
    expect(flying.age).toBeGreaterThanOrEqual(flying.lifetime);
  });
});

/**
 * DESIGN 8번 두 번째 카드 — 관통.
 *
 * 여기서 지키는 것은 둘이다: 뒤에 선 놈까지 뚫고 가는가, 그리고 **한 놈을 한 번만
 * 맞히는가.** 두 번째가 진짜 함정이다 — 한 프레임에 나아가는 거리(34m/s × 1/60 ≈ 0.57m)가
 * 적 판정 지름(1.72m)보다 짧아서, 맞힌 적을 기억하지 않으면 몸을 빠져나가는 서너 프레임 동안
 * 계속 꽂힌다. 그러면 관통이 아니라 "가까이 붙으면 피해 3배"가 된다.
 */
describe('stepArrows — 관통', () => {
  /** 화살 하나를 여러 스텝 날리고 그동안의 명중을 합친다. */
  function fly(flying: Arrow, enemies: ReturnType<typeof enemyAt>[], steps: number): number {
    let hits = 0;
    for (let i = 0; i < steps; i += 1) hits += stepArrows([flying], options({ enemies })).hits;
    return hits;
  }

  it('관통이 없으면 처음 맞힌 자리에서 멈춘다', () => {
    const line = [enemyAt(2, 0), enemyAt(5, 0)];
    const flying = arrow(0, 0, 34, 0);
    expect(fly(flying, line, 30)).toBe(1);
    expect(flying.alive).toBe(false);
    expect(line[1]?.hp).toBe(ENEMY.maxHp);
  });

  it('관통이 남은 만큼 뒤엣놈을 뚫고 가다가, 다 쓰면 거기서 멈춘다', () => {
    const line = [enemyAt(2, 0), enemyAt(5, 0), enemyAt(8, 0)];
    const flying = arrow(0, 0, 34, 0, 'player', 1, 1);
    expect(fly(flying, line, 30)).toBe(2);
    expect(flying.alive).toBe(false);
    expect(line[0]?.hp).toBe(ENEMY.maxHp - 1);
    expect(line[1]?.hp).toBe(ENEMY.maxHp - 1);
    // 관통을 다 쓴 뒤에 만난 셋째는 멀쩡하다.
    expect(line[2]?.hp).toBe(ENEMY.maxHp);
  });

  it('한 놈을 여러 프레임에 걸쳐 다시 맞히지 않는다', () => {
    // 느린 화살이라 적의 몸 안에 열 프레임 넘게 머문다. 기억하지 않으면 그만큼 꽂힌다.
    const slow = arrow(0, 0, 6, 0, 'player', 1, 2);
    const single = [enemyAt(1, 0)];
    expect(fly(slow, single, 40)).toBe(1);
    // 관통을 한 번만 쓰고 계속 날아간다.
    expect(slow.pierce).toBe(1);
    expect(slow.alive).toBe(true);
  });

  it('쓰러뜨린 뒤에도 남은 관통으로 다음 놈을 맞힌다', () => {
    const front = enemyAt(2, 0);
    front.hp = 1;
    const line = [front, enemyAt(5, 0)];
    const flying = arrow(0, 0, 34, 0, 'player', 1, 1);
    expect(fly(flying, line, 30)).toBe(2);
    expect(front.alive).toBe(false);
    expect(line[1]?.hp).toBe(ENEMY.maxHp - 1);
  });
});

/**
 * DESIGN 8번 세 번째 카드 — 튕김.
 *
 * 관통이 깔아 둔 자리(`Arrow.pierce`·`Arrow.hitIds`)를 그대로 쓰되, 하는 일이 다르다.
 * 관통은 **가던 대로 더 가고**, 튕김은 **방향을 꺾어 더 간다**.
 * 그래서 여기서 지키는 것은 셋이다: 꺾여서 다음 놈에게 닿는가, 갈 곳이 없으면
 * 깨끗이 사라지는가, 그리고 **관통과 겹쳤을 때 뚫는 몫을 먼저 쓰는가.**
 */
describe('stepArrows — 튕김', () => {
  /** 화살 하나를 여러 스텝 날리고 그동안의 명중을 합친다. */
  function fly(flying: Arrow, enemies: ReturnType<typeof enemyAt>[], steps: number): number {
    let hits = 0;
    for (let i = 0; i < steps; i += 1) hits += stepArrows([flying], options({ enemies })).hits;
    return hits;
  }

  it('맞히면 옆에 선 다음 놈에게 꺾여 간다', () => {
    const front = enemyAt(3, 0);
    const side = enemyAt(3, 5);
    const flying = arrow(0, 0, 34, 0, 'player', 1, 0, 1);
    expect(fly(flying, [front, side], 60)).toBe(2);
    expect(front.hp).toBe(ENEMY.maxHp - 1);
    expect(side.hp).toBe(ENEMY.maxHp - 1);
    // 튕김을 다 썼으므로 두 번째 놈에게서는 사라진다.
    expect(flying.alive).toBe(false);
  });

  it('튕김이 남아 있으면 두 놈 사이를 오간다 (직전에 맞힌 놈만 건너뛴다)', () => {
    // 지나온 모두를 계속 기억하면 여기서 갈 곳이 없어져 카드가 한 번밖에 일하지 못한다.
    const first = enemyAt(3, 0);
    const second = enemyAt(3, 5);
    const flying = arrow(0, 0, 34, 0, 'player', 1, 0, 2);
    expect(fly(flying, [first, second], 60)).toBe(3);
    expect(first.hp).toBe(ENEMY.maxHp - 2);
    expect(second.hp).toBe(ENEMY.maxHp - 1);
  });

  it('튕겨 갈 상대가 없으면 그 자리에서 사라진다', () => {
    const alone = enemyAt(3, 0);
    const flying = arrow(0, 0, 34, 0, 'player', 1, 0, 2);
    expect(fly(flying, [alone], 60)).toBe(1);
    expect(flying.alive).toBe(false);
    // 갈 곳이 없었으므로 튕김은 한 번도 쓰이지 않았다.
    expect(flying.bounce).toBe(2);
  });

  it('사거리 밖의 적에게는 튕기지 않는다 (유도탄이 되지 않는다)', () => {
    const front = enemyAt(3, 0);
    const far = enemyAt(3, ARROW.bounceRange + 1);
    const flying = arrow(0, 0, 34, 0, 'player', 1, 0, 1);
    expect(fly(flying, [front, far], 60)).toBe(1);
    expect(far.hp).toBe(ENEMY.maxHp);
    expect(flying.alive).toBe(false);
  });

  it('꺾여도 속력은 그대로고 수명은 처음부터 다시 센다', () => {
    const front = enemyAt(3, 0);
    const side = enemyAt(3, 5);
    const flying = arrow(0, 0, 34, 0, 'player', 1, 0, 1);
    for (let i = 0; i < 60 && flying.bounce > 0; i += 1) {
      stepArrows([flying], options({ enemies: [front, side] }));
    }
    expect(flying.bounce).toBe(0);
    // 느려지면 피할 수 있게 되고, 수명을 이어 세면 멀리 있는 다음 상대에게 닿지 못한다.
    expect(Math.hypot(flying.vel.x, flying.vel.y)).toBeCloseTo(34, 6);
    expect(flying.age).toBe(0);
  });

  it('관통이 남아 있는 동안에는 더 가까운 적이 옆에 있어도 꺾지 않는다', () => {
    // 한 줄로 선 셋과, 곁길로 빠진 하나. 뚫는 몫을 먼저 쓰지 않으면 첫 놈에게서
    // 곧바로 곁길로 꺾여 줄 끝까지 가지 못한다.
    const line = [enemyAt(3, 0), enemyAt(6, 0), enemyAt(9, 0)];
    const aside = enemyAt(3, 3);
    const flying = arrow(0, 0, 34, 0, 'player', 1, 2, 1);
    fly(flying, [...line, aside], 60);
    for (const enemy of line) expect(enemy.hp).toBeLessThan(ENEMY.maxHp);
    expect(aside.hp).toBe(ENEMY.maxHp);
    // 줄 끝에서 관통이 바닥나고, 거기서 한 번 꺾였다.
    expect(flying.pierce).toBe(0);
    expect(flying.bounce).toBe(0);
  });
});

/**
 * DESIGN 9번 — 방패병의 방패. **이 적이 요구하는 것("돌아서 쏴라")이 성립하는 자리다.**
 *
 * 여기서 지키는 것은 넷이다:
 * 1. 정면은 막고 **옆구리는 뚫린다** — 돌아가는 것이 실제로 값져야 한다.
 * 2. **겨누는 동안에는 정면도 뚫린다** — 가장 위험한 순간이 곧 가장 무른 순간이다.
 * 3. **결국 부서진다** — 돌아가지 못하는 사람의 화살이 영원히 튕기면 고장으로 읽힌다.
 * 4. **카드가 방패를 무시하지 못한다** — 관통 한 장에 이 적의 규칙이 사라지면 안 된다.
 */
describe('stepArrows — 방패병의 방패', () => {
  /**
   * 원점의 방패병. `facing`은 +x를 본다 — 정면은 +x 쪽에서 날아오는 화살이다.
   * 아래 화살들은 속력 120으로 두어 한 프레임(1/60초)에 2m를 나아간다.
   * 2m 밖에서 쏘면 그 한 프레임에 적의 한가운데를 지나므로 판정이 확실하다.
   */
  const shielded = (): ReturnType<typeof createEnemy> => {
    const enemy = createEnemy(nextId++, 0, 0, SHIELD.maxHp, 'shield', SHIELD.shieldHp);
    enemy.facing = 0;
    return enemy;
  };

  it('정면으로 날아온 화살은 방패가 받는다 (몸에는 닿지 않는다)', () => {
    const enemy = shielded();
    const result = stepArrows([arrow(2, 0, -120, 0)], options({ enemies: [enemy] }));
    expect(result.blocked).toBe(1);
    expect(result.hits).toBe(0);
    expect(enemy.hp).toBe(SHIELD.maxHp);
    expect(enemy.shieldHp).toBe(SHIELD.shieldHp - 1);
  });

  it('옆구리로 들어온 화살은 그냥 뚫는다 (돌아간 보람이 있어야 한다)', () => {
    const enemy = shielded();
    const result = stepArrows([arrow(0, 2, 0, -120)], options({ enemies: [enemy] }));
    expect(result.hits).toBe(1);
    expect(enemy.hp).toBe(SHIELD.maxHp - 1);
    expect(enemy.shieldHp).toBe(SHIELD.shieldHp);
  });

  it('부채꼴 밖으로 30°만 돌아도 열린다 (막는 것은 정면 150°뿐이다)', () => {
    const inside = SHIELD.arc - 0.2;
    const outside = SHIELD.arc + 0.2;
    for (const [angle, blocked] of [
      [inside, 1],
      [outside, 0],
    ] as const) {
      const enemy = shielded();
      // 적을 중심으로 angle만큼 돌아선 자리에서 적을 향해 쏜다.
      const at = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };
      const shot = arrow(at.x, at.y, -at.x * 60, -at.y * 60);
      expect(stepArrows([shot], options({ enemies: [enemy] })).blocked).toBe(blocked);
    }
  });

  it('겨누는 동안에는 정면도 뚫린다 (쏘려면 방패를 내려야 한다)', () => {
    const enemy = shielded();
    enemy.aimTimer = SHIELD.aimTime;
    const result = stepArrows([arrow(2, 0, -120, 0)], options({ enemies: [enemy] }));
    expect(result.hits).toBe(1);
    expect(enemy.hp).toBe(SHIELD.maxHp - 1);
  });

  it('관통 화살도 방패에서 멈춘다 (카드 한 장이 이 적을 지우지 못한다)', () => {
    const enemy = shielded();
    const piercing = arrow(2, 0, -120, 0, 'player', 1, 3);
    stepArrows([piercing], options({ enemies: [enemy] }));
    expect(piercing.alive).toBe(false);
    expect(piercing.pierce).toBe(3);
  });

  it('활잡이와 돌진형은 아무것도 막지 않는다', () => {
    for (const enemy of [enemyAt(0, 0), createEnemy(nextId++, 0, 0, ENEMY.maxHp, 'charger')]) {
      enemy.facing = 0;
      expect(stepArrows([arrow(2, 0, -120, 0)], options({ enemies: [enemy] })).hits).toBe(1);
    }
  });

  it('정면은 여덟 발, 옆구리는 세 발 — 돌아가는 쪽이 두 배 넘게 빠르다', () => {
    /** 적이 쓰러질 때까지 한 발씩 쏜다. from에서 적을 향해 날아간다. */
    const arrowsToKill = (from: { x: number; y: number }): number => {
      const enemy = shielded();
      for (let shots = 1; shots <= 30; shots += 1) {
        stepArrows(
          [arrow(from.x, from.y, -from.x * 60, -from.y * 60)],
          options({ enemies: [enemy] }),
        );
        if (!enemy.alive) return shots;
      }
      return -1;
    };

    const front = arrowsToKill({ x: 2, y: 0 });
    const flank = arrowsToKill({ x: 0, y: 2 });
    expect(front).toBe(SHIELD.shieldHp + SHIELD.maxHp);
    expect(flank).toBe(SHIELD.maxHp);
    expect(front).toBeGreaterThan(flank * 2);
  });
});

/**
 * DESIGN 8번 아홉째 카드 — 밀어내기.
 *
 * 앞의 여덟 장과 다른 것을 바꾸는 첫 장이다. 나머지는 전부 **내가** 얼마나 세거나 빠른가를
 * 바꾸지만, 이 장은 **적이 어디에 서는가**를 바꾼다. 그래서 지키는 것도 다르다 —
 * "얼마나 아픈가"가 아니라 **"누가 밀리고 누가 안 밀리는가"**다.
 *
 * 밀지 않는 자리가 이 카드의 전부다. 저지르기 시작한 적까지 밀리면
 * 카드 한 장이 적 넷의 요구(계속 움직여라·옆으로 비켜라·돌아서 쏴라·물러나라)를
 * 통째로 지운다 — 예고를 보고 피하는 게임이 예고를 밀어내는 게임이 된다.
 */
describe('stepArrows — 밀어내기', () => {
  /** 원점의 적. 속력 120이라 한 프레임(1/60초)에 2m를 나아가 한가운데를 지난다. */
  const target = (kind: Parameters<typeof createEnemy>[4] = 'archer') =>
    createEnemy(nextId++, 0, 0, 99, kind);

  /** +x로 날아가는 화살 한 발을 한 프레임 먹이고, 적이 옮겨 간 자리를 돌려준다. */
  function pushed(enemy: ReturnType<typeof createEnemy>, knockback: number, obstacles = []) {
    stepArrows(
      [arrow(-2, 0, 120, 0, 'player', 1, 0, 0, knockback)],
      options({ enemies: [enemy], obstacles }),
    );
    return enemy.pos;
  }

  it('맞은 적이 화살이 가던 쪽으로 그만큼 밀린다', () => {
    const enemy = target();
    expect(pushed(enemy, 0.45)).toEqual({ x: 0.45, y: 0 });
  });

  it('밀어내기가 없는 화살은 아무도 옮기지 않는다 (지금까지의 화살이 전부 그렇다)', () => {
    const enemy = target();
    expect(pushed(enemy, 0)).toEqual({ x: 0, y: 0 });
  });

  /**
   * **방향은 위치가 아니라 속도로 잰다.** 한 프레임에 2m를 나아가는 화살은 적의 몸
   * 반대편(+x 쪽)에서 판정되는 프레임이 있어, 위치 차이로 재면 밀리는 방향이 뒤집힌다.
   * `blocksArrow`가 방패의 정면을 속도로 재는 것과 같은 이유다.
   */
  it('몸을 지나쳐 판정된 화살도 가던 쪽으로 민다 (뒤로 당기지 않는다)', () => {
    const enemy = target();
    stepArrows(
      [arrow(-0.1, 0, 120, 0, 'player', 1, 0, 0, 0.45)],
      options({ enemies: [enemy] }),
    );
    expect(enemy.pos.x).toBeCloseTo(0.45, 6);
  });

  it('겨누는 적은 밀리지 않는다 — 예고를 밀어서 지울 수 없다', () => {
    const enemy = target();
    enemy.aimTimer = 0.3;
    expect(pushed(enemy, 0.45)).toEqual({ x: 0, y: 0 });
  });

  it('심지에 불이 붙은 폭탄병은 그 자리에서 터진다', () => {
    // 폭탄병의 심지도 `aimTimer`다(`systems/enemyAi.ts`). 밀어서 치울 수 있으면
    // "물러나라"가 답이 아니게 되고, 그러면 이 적은 카드 한 장으로 사라진다.
    const enemy = target('bomber');
    enemy.aimTimer = BOMBER.fuse;
    expect(pushed(enemy, 0.45)).toEqual({ x: 0, y: 0 });
  });

  it('몸을 던진 돌진형은 궤도가 휘지 않는다', () => {
    // 직선이라는 약속이 곧 피할 여지다.
    const enemy = target('charger');
    enemy.dashTimer = CHARGER.dashTime;
    expect(pushed(enemy, 0.45)).toEqual({ x: 0, y: 0 });
  });

  it('쓰러뜨린 적은 밀지 않는다 — 눕는 자리가 곧 코어가 떨어지는 자리다', () => {
    const enemy = target();
    enemy.hp = 1;
    const result = stepArrows(
      [arrow(-2, 0, 120, 0, 'player', 1, 0, 0, 0.45)],
      options({ enemies: [enemy] }),
    );
    expect(result.killed).toHaveLength(1);
    expect(enemy.pos).toEqual({ x: 0, y: 0 });
  });

  it('벽 너머로는 밀리지 않는다', () => {
    const enemy = target();
    const wall = 26 - ENEMY.radius; // 벽에 등을 붙이고 선 자리.
    enemy.pos = { x: wall, y: 0 };
    stepArrows(
      [arrow(wall - 2, 0, 120, 0, 'player', 1, 0, 0, 0.45)],
      options({ enemies: [enemy] }),
    );
    expect(enemy.hp).toBeLessThan(99); // 맞지도 않았다면 이 검사는 아무것도 재지 않는다.
    expect(enemy.pos.x).toBeCloseTo(wall, 6);
  });

  it('기둥에 등을 붙인 적은 더 밀리지 않는다', () => {
    const enemy = target();
    const pillar = { x: 2, y: 0, radius: 1.2 };
    enemy.pos = { x: pillar.x - pillar.radius - ENEMY.radius, y: 0 };
    const before = enemy.pos.x;
    stepArrows(
      [arrow(before - 2, 0, 120, 0, 'player', 1, 0, 0, 0.45)],
      options({ enemies: [enemy], obstacles: [pillar] }),
    );
    expect(enemy.pos.x).toBeCloseTo(before, 6);
  });
});
