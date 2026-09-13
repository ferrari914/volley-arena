import { describe, expect, it } from 'vitest';
import { ARENA, ENEMY, PLAYER, REINFORCE } from '../src/data/config';
import { MAPS, findMap, DEFAULT_MAP, type ArenaMap } from '../src/data/maps';
import { World } from '../src/core/World';
import { createEnemy, createPlayer, type Arrow, type Obstacle } from '../src/entities/types';
import { movePlayer } from '../src/systems/movement';
import { stepArrows } from '../src/systems/combat';
import { blockedByObstacles, insideObstacle, pushOutOfObstacles } from '../src/systems/obstacles';
import { SHIELD } from '../src/data/config';
import { DT, IDLE, median, play, playMatch, walkToNearestCore } from './support/match';

/**
 * 맵(DESIGN 10번)을 재는 자.
 *
 * **셋을 따로 잰다.**
 *   ① 데이터가 서로 겹치지 않는가 — 맵을 하나 더 넣는 사람이 가장 먼저 밟을 자리다.
 *   ② 기둥이 실제로 막는가 — 몸도 화살도 코어도.
 *   ③ **맵이 게임의 성질을 무르게 만들지 않는가** — 여기가 이 파일의 이유다.
 *      DESIGN 5번("서 있으면 쓰러진다")과 품질 기준("한 판 3~5분")은 게임의 성질이지
 *      맵의 성질이 아니다. 맵 하나가 그것을 깨면 그 맵에서는 다른 게임이 도는 셈이다.
 *      실제로 처음 세운 10.5m 고리가 **서 있기를 40 → 115초**로 만들었고,
 *      그것을 잡은 것이 ③이다(자세한 것은 `data/maps.ts`의 기둥 주석에 있다).
 */

/**
 * 이 파일이 쓰는 화살은 한 종류뿐이다 — 한복판에서 +x로 똑바로 날아가는 플레이어의 화살.
 * 기둥이 막는가만 보므로 관통도 튕김도 0이다(막힘은 그 둘보다 먼저 온다).
 */
const straightArrow = (id: number, speed: number): Arrow => ({
  id,
  owner: 'player',
  pos: { x: 0, y: 0 },
  vel: { x: speed, y: 0 },
  damage: 1,
  age: 0,
  lifetime: 3,
  pierce: 0,
  bounce: 0,
  alive: true,
});

/** 몸 하나가 지나갈 수 있는 최소 폭(m). 적의 지름(1.2m)에 여유를 얹었다. */
const PASSABLE = 2.0;

const arenaEdge = (pillar: Obstacle): number =>
  ARENA.radius - (Math.hypot(pillar.x, pillar.y) + pillar.radius);

describe('맵 데이터 — 맵을 하나 더 넣는 사람이 지켜야 하는 것', () => {
  it('이름표가 겹치지 않고, 이름과 한 줄 설명이 비어 있지 않다', () => {
    const ids = MAPS.map((m) => m.id);
    expect(new Set(ids).size, `겹치는 이름표: ${ids.join(' · ')}`).toBe(ids.length);
    for (const map of MAPS) {
      expect(map.name.length, `${map.id}의 이름`).toBeGreaterThan(0);
      expect(map.blurb.length, `${map.id}의 설명`).toBeGreaterThan(0);
    }
  });

  it('모르는 이름표는 기본 맵으로 받는다 (옛 저장값·손으로 고친 주소)', () => {
    expect(findMap('없는맵')).toBe(DEFAULT_MAP);
    expect(findMap(null)).toBe(DEFAULT_MAP);
    expect(findMap('pillars').id).toBe('pillars');
  });

  it('기본 맵은 기둥이 없다 — 지금까지 잰 밸런스 수치가 전부 그 맵의 것이다', () => {
    expect(DEFAULT_MAP.id).toBe('open');
    expect(DEFAULT_MAP.obstacles).toEqual([]);
  });

  for (const map of MAPS) {
    describe(`${map.name}(${map.id})`, () => {
      it('기둥이 아레나 안에 있고, 벽 사이로 지나갈 수 있다', () => {
        for (const pillar of map.obstacles) {
          expect(arenaEdge(pillar), `${JSON.stringify(pillar)}와 벽 사이`).toBeGreaterThanOrEqual(
            PASSABLE,
          );
        }
      });

      it('기둥끼리 겹치지 않고, 사이로 지나갈 수 있다', () => {
        for (let i = 0; i < map.obstacles.length; i += 1) {
          for (let j = i + 1; j < map.obstacles.length; j += 1) {
            const a = map.obstacles[i] as Obstacle;
            const b = map.obstacles[j] as Obstacle;
            const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
            expect(gap, `기둥 ${i}와 ${j} 사이`).toBeGreaterThanOrEqual(PASSABLE);
          }
        }
      });

      it('처음 선 적이 기둥에 겹쳐 있지 않다', () => {
        // 겹쳐 세우면 판이 열리는 첫 프레임에 적이 밀려나, 데이터에 적힌 자리와
        // 실제로 선 자리가 달라진다. 그러면 배치를 읽어도 화면을 알 수 없다.
        //
        // **미는 함수를 그대로 불러 본다.** 손으로 거리 선을 하나 정해 두면 그 수가
        // 게임이 쓰는 선과 어긋나서, 멀쩡한 배치를 막거나 겹친 배치를 놓친다
        // (처음 쓴 선이 `ENEMY.radius + 1`이었는데 실제로 미는 선은 `ENEMY.radius`다).
        for (const spawn of map.enemies) {
          const clear = pushOutOfObstacles(spawn, ENEMY.radius, map.obstacles);
          const moved = Math.hypot(clear.x - spawn.x, clear.y - spawn.y);
          expect(moved, `적 ${JSON.stringify(spawn)}이 첫 프레임에 밀려난다`).toBe(0);
        }
      });

      it('판이 열릴 때 서는 자리(한복판)가 비어 있다', () => {
        // 시작하자마자 시야가 막히면 처음 하는 사람이 무슨 게임인지 못 본다
        // (DESIGN 품질 기준 · 설명 없이 30초 안에 조작을 이해할 것).
        expect(insideObstacle({ x: 0, y: 0 }, PLAYER.radius + 2, map.obstacles)).toBe(false);
      });

      it('증원이 걸어 들어오는 고리를 기둥이 막지 않는다', () => {
        // 자리를 못 찾으면 증원이 엉뚱한 곳에 서고, 위쪽 꼬리를 붙잡는 유일한 장치가
        // 조용히 헐거워진다(`REINFORCE` · World.pickReinforceSpawn).
        for (const pillar of map.obstacles) {
          const reach = Math.abs(Math.hypot(pillar.x, pillar.y) - REINFORCE.spawnRadius);
          expect(reach, `기둥 ${JSON.stringify(pillar)}이 증원 고리에 걸린다`).toBeGreaterThan(
            pillar.radius + ENEMY.radius,
          );
        }
      });
    });
  }
});

describe('기둥 규칙 — 몸도 화살도 코어도 지나가지 못한다', () => {
  const pillar: Obstacle = { x: 5, y: 0, radius: 2 };
  const pillars = [pillar];

  it('걸어서 뚫고 지나갈 수 없다', () => {
    let pos = { x: 0, y: 0 };
    for (let i = 0; i < 240; i += 1) {
      pos = movePlayer(pos, { x: 1, y: 0 }, DT, PLAYER.speed, ARENA.radius, PLAYER.radius, pillars);
    }
    // 4초를 밀어붙여도 기둥 앞에 선다. 반대편(x > 7)에 가 있으면 뚫은 것이다.
    expect(pos.x).toBeLessThan(pillar.x - pillar.radius);
    expect(Math.hypot(pos.x - pillar.x, pos.y - pillar.y)).toBeGreaterThanOrEqual(
      pillar.radius + PLAYER.radius - 1e-6,
    );
  });

  it('비스듬히 닿으면 미끄러져 지나간다 (벽과 같은 규칙)', () => {
    // 정면이 아니라 기둥의 위쪽 어깨로 들어간다. 발이 묶이면 이 사람은 영영 못 지나간다.
    let pos = { x: 0, y: 1.6 };
    for (let i = 0; i < 360; i += 1) {
      pos = movePlayer(pos, { x: 1, y: 0 }, DT, PLAYER.speed, ARENA.radius, PLAYER.radius, pillars);
    }
    expect(pos.x, '어깨에 걸려 발이 묶였다').toBeGreaterThan(pillar.x + pillar.radius);
  });

  it('한복판에 놓인 몸도 밖으로 밀려난다 (갇히지 않는다)', () => {
    const out = pushOutOfObstacles({ x: pillar.x, y: pillar.y }, PLAYER.radius, pillars);
    expect(Math.hypot(out.x - pillar.x, out.y - pillar.y)).toBeCloseTo(
      pillar.radius + PLAYER.radius,
    );
  });

  it('화살이 기둥에 막히고, 기둥이 없으면 같은 화살이 맞힌다', () => {
    const options = (obstacles: readonly Obstacle[]) => ({
      dt: DT,
      arenaRadius: ARENA.radius,
      arrowRadius: 0.12,
      enemyRadius: ENEMY.radius,
      playerRadius: PLAYER.radius,
      invulnerable: PLAYER.invulnerable,
      respawnDelay: ENEMY.respawnDelay,
      bounceRange: 6,
      shieldArc: SHIELD.arc,
      obstacles,
      player: createPlayer(PLAYER.maxHp),
      enemies: [createEnemy(1, 10, 0, ENEMY.maxHp)],
    });

    const blockedRun = options(pillars);
    const arrow = straightArrow(1, 60);
    // 기둥(x=5)을 지나 적(x=10)까지 가는 궤적. 한 스텝이 1m라 여러 스텝을 돌린다.
    for (let i = 0; i < 12; i += 1) stepArrows([arrow], blockedRun);
    expect(arrow.alive, '기둥을 지나쳤다').toBe(false);
    expect(blockedRun.enemies[0]?.hp).toBe(ENEMY.maxHp);

    const openRun = options([]);
    const twin = straightArrow(2, 60);
    for (let i = 0; i < 12; i += 1) stepArrows([twin], openRun);
    expect(openRun.enemies[0]?.hp, '기둥이 없어도 안 맞았다 — 자에 이가 없다').toBe(
      ENEMY.maxHp - 1,
    );
  });

  it('한 프레임에 기둥을 뛰어넘지 못한다 (터널링)', () => {
    // 한 스텝에 기둥의 지름보다 멀리 나아가는 화살. 위치만 비교하면 그냥 통과한다.
    const from = { x: 0, y: 0 };
    const to = { x: 12, y: 0 };
    expect(blockedByObstacles(from, to, 0.12, pillars)).toBe(true);
    expect(blockedByObstacles({ x: 0, y: 9 }, { x: 12, y: 9 }, 0.12, pillars)).toBe(false);
  });
});

describe('기둥이 선 판 — 한 판을 돌려서 본다', () => {
  const map = findMap('pillars');

  it('적도 코어도 기둥 속에 들어가지 않는다', () => {
    const world = new World({ seed: 20260909, map });
    // 쓰러지지 않게 두고 오래 돌린다 — 증원과 드롭까지 다 나와야 볼 수 있다.
    for (let i = 0; i < 60 * 180; i += 1) {
      world.player.hp = world.player.maxHp;
      const first = world.offer?.choices[0];
      if (first) world.chooseUpgrade(first.card.id);
      world.step(walkToNearestCore(world), DT);

      for (const enemy of world.enemies) {
        if (!enemy.alive) continue;
        expect(
          insideObstacle(enemy.pos, ENEMY.radius - 1e-3, map.obstacles),
          `적 ${enemy.id}이 기둥 속에 있다`,
        ).toBe(false);
      }
    }
    for (const core of world.cores) {
      expect(insideObstacle(core.pos, 0, map.obstacles), '코어가 기둥 속에 있다').toBe(false);
    }
  });

  it('기둥이 화살을 실제로 먹는다 — 같은 씨앗의 처치가 줄어든다', () => {
    // 기둥이 게임에 닿아 있다는 증거. 여기가 같아지면 이 맵은 그림만 다른 맵이다.
    const seeds = Array.from({ length: 20 }, (_, i) => 20260909 + i);
    const kills = (m: ArenaMap): number =>
      median(seeds.map((seed) => playMatch(seed, 600, walkToNearestCore, undefined, m).kills));
    const open = kills(DEFAULT_MAP);
    const withPillars = kills(map);
    console.log(`처치 중앙값 — 빈 뜰 ${open.toFixed(0)} · 기둥 뜰 ${withPillars.toFixed(0)}`);
    expect(withPillars).toBeLessThan(open * 0.95);
  });
});

/**
 * **맵이 게임의 성질을 무르게 만들지 않는다.**
 *
 * 여기 있는 두 선은 `tests/progression.test.ts`가 기본 맵에 걸어 둔 것과 같은 선이고,
 * 같은 자(씨앗 20판의 중앙값)로 잰다. 다른 것은 **맵 전부에 건다**는 것뿐이다.
 * 맵을 하나 더 넣는 바퀴는 이 묶음이 통과할 때까지가 그 일이다.
 */
describe('밸런스 — 어느 맵에서도 (씨앗 20개)', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);
  const SHORTEST = 150;
  const LONGEST = 330;

  for (const map of MAPS) {
    it(`${map.name} — 한 판의 중앙값이 3~5분 안에 들고, 서 있으면 1분 안에 쓰러진다`, () => {
      const lengths = SEEDS.map(
        (seed) => playMatch(seed, 600, walkToNearestCore, undefined, map).elapsed,
      );
      const standing = SEEDS.map((seed) => {
        const world = new World({ seed, map });
        play(world, 60 * 120, () => IDLE);
        return world.elapsed;
      });
      const longestStand = Math.max(...standing);

      console.log(
        `  ${map.name.padEnd(6)} 한 판 중앙 ${median(lengths).toFixed(0)}초 · ` +
          `서 있기 중앙 ${median(standing).toFixed(0)}초(최장 ${longestStand.toFixed(0)})`,
      );

      expect(median(lengths), `${map.id}의 한 판 중앙값`).toBeGreaterThan(SHORTEST);
      expect(median(lengths), `${map.id}의 한 판 중앙값`).toBeLessThan(LONGEST);
      expect(median(standing), `${map.id}에서 서 있기`).toBeLessThan(60);
      expect(longestStand, `${map.id}에서 가장 운 좋은 서 있기`).toBeLessThan(75);
    });
  }
});
