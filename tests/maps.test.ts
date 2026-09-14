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

/** 화살의 몸 반지름(m). `systems/combat.ts`가 쓰는 값과 같다. */
const ARROW_RADIUS = 0.12;

/** 물러나 벽에 붙어 선 자리까지의 거리(m). 기둥(바깥 끝 20.2m)과 벽(26m) 사이다. */
const RETREAT = 23;

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

/**
 * **가림(cover)** — 어떤 자리에 선 사람이 **몇 도에서 안 보이는가.**
 *
 * 활잡이가 다가와 서는 거리(`ENEMY.approachDistance` 12m)로 한 바퀴 선을 그어,
 * 기둥에 막히는 각을 더한다. 0도면 사방에서 다 보이고, 360도면 아무도 못 본다.
 *
 * **왜 시간이 아니라 각으로 재는가**: "여기 숨으면 몇 초 사는가"는 씨앗과 배치가
 * 조금만 달라져도 88~182초로 튄다(세션 47이 36가지 배치로 재 봤다 — STATUS에 표가 있다).
 * 그 위에 합격선을 그으면 다음 바퀴가 흔들리는 자를 물려받는다. 가림 각은 기둥 데이터만
 * 보는 결정적 계산이라 늘 같은 값이 나오고, **막는 것은 기둥이지 운이 아니다.**
 */
const cover = (at: { x: number; y: number }, obstacles: readonly Obstacle[]): number => {
  let blocked = 0;
  for (let deg = 0; deg < 360; deg += 2) {
    const a = (deg * Math.PI) / 180;
    const to = {
      x: at.x + Math.cos(a) * ENEMY.approachDistance,
      y: at.y + Math.sin(a) * ENEMY.approachDistance,
    };
    if (blockedByObstacles(at, to, ARROW_RADIUS, obstacles)) blocked += 2;
  }
  return blocked;
};

/** 물러나 벽에 붙은 자리에서, 그 방향의 가림 각. */
const coverToward = (deg: number, map: ArenaMap): number => {
  const a = (deg * Math.PI) / 180;
  return cover({ x: Math.cos(a) * RETREAT, y: Math.sin(a) * RETREAT }, map.obstacles);
};

/** 사람이 설 수 있는 자리 전부를 훑어, 가장 가려지는 자리를 찾는다. */
const deepestShade = (map: ArenaMap): { deg: number; at: { x: number; y: number } } => {
  let best = { deg: -1, at: { x: 0, y: 0 } };
  for (let x = -ARENA.radius; x <= ARENA.radius; x += 0.5) {
    for (let y = -ARENA.radius; y <= ARENA.radius; y += 0.5) {
      const at = { x, y };
      if (Math.hypot(x, y) > ARENA.radius - PLAYER.radius) continue;
      if (insideObstacle(at, PLAYER.radius, map.obstacles)) continue;
      const deg = cover(at, map.obstacles);
      if (deg > best.deg) best = { deg, at };
    }
  }
  return best;
};

describe('가림 — 어느 맵도 요새를 만들지 않는다', () => {
  /**
   * **아레나 어디에 서도 절반 넘게 가려지지 않는다.**
   *
   * 반이 열려 있으면 적은 늘 돌아가서 쏠 자리가 있다. 반 넘게 가려지는 자리가 하나라도
   * 생기면 거기서는 손을 놓고 서 있어도 화살이 오지 않고, 그 자리에서만 DESIGN 5번
   * ("가만히 서 있으면 쓰러진다")이 다른 게임이 된다.
   *
   * 180도는 재서 맞춘 값이 아니라 **"열린 반쪽이 남는다"는 규칙 그 자체**다.
   * 실측은 빈 뜰 0도 · 기둥 뜰 150도 · 그늘 뜰 150도(버린 초안 206도).
   */
  for (const map of MAPS) {
    it(`${map.name} — 반 넘게 가려지는 자리가 없다`, () => {
      const worst = deepestShade(map);
      console.log(
        `  ${map.name.padEnd(6)} 가장 깊은 그늘 ${worst.deg}도 @(${worst.at.x},${worst.at.y})`,
      );
      expect(worst.deg, `${map.id}에 요새가 생겼다`).toBeLessThan(180);
    });
  }

  it('자에 이가 있다 — 버린 배치(셋을 90도 안에 굵게)는 걸린다', () => {
    // 그늘 뜰의 초안이다. 셋을 90도 안에 굵게 세웠더니 그늘이 겹쳐 206도짜리 굴이 생겼고,
    // 거기 숨어 서면 손을 놓고도 168초를 버텼다(빈 뜰 39 · 기둥 뜰 134).
    const rejected = [45, 90, 135].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { x: Math.cos(a) * 17, y: Math.sin(a) * 17, radius: 3.9 };
    });
    const worst = deepestShade({ ...DEFAULT_MAP, obstacles: rejected });
    console.log(`  버린 초안 가장 깊은 그늘 ${worst.deg}도 @(${worst.at.x},${worst.at.y})`);
    expect(worst.deg).toBeGreaterThanOrEqual(180);
  });
});

describe('그늘 뜰 — 물러날 곳이 둘로 갈린다', () => {
  /**
   * 이 맵이 있는 이유 전부가 여기 있다. 앞의 두 맵은 **어느 방향으로 돌아도 같은 맵**이라
   * 물러날 때 고를 것이 없다 — 빈 뜰은 어디나 0도, 기둥 뜰은 어디나 50~68도다.
   * 그늘 뜰만 한쪽이 기둥 뜰이고 반대쪽이 빈 뜰이다.
   *
   * 여기가 무너지면 이 맵은 기둥 수만 다른 기둥 뜰이 된다.
   */
  const SHADE = [15, 45, 75, 105, 135];
  const OPEN = [195, 225, 255, 285, 315];

  it('그늘 쪽은 기둥 뜰만큼 가리고, 트인 쪽은 빈 뜰처럼 하나도 안 가린다', () => {
    const shade = findMap('shade');
    const pillars = findMap('pillars');
    const shadeSide = SHADE.map((d) => coverToward(d, shade));
    const openSide = OPEN.map((d) => coverToward(d, shade));
    const ring = SHADE.concat(OPEN).map((d) => coverToward(d, pillars));
    console.log(
      `  그늘 뜰 — 그늘 쪽 ${Math.min(...shadeSide)}~${Math.max(...shadeSide)}도 · ` +
        `트인 쪽 ${Math.min(...openSide)}~${Math.max(...openSide)}도 · ` +
        `기둥 뜰(견줌) ${Math.min(...ring)}~${Math.max(...ring)}도`,
    );

    expect(Math.min(...shadeSide), '그늘 쪽이 가리지 않는다').toBeGreaterThanOrEqual(
      Math.min(...ring),
    );
    expect(Math.max(...openSide), '트인 쪽에도 가림이 있다').toBe(0);
  });

  it('앞의 두 맵은 어느 쪽으로 물러나도 같다 — 고를 것이 없다', () => {
    // 견줌이 없으면 위 검사가 "그늘 뜰이 특별한가"를 말하지 못한다.
    for (const map of [DEFAULT_MAP, findMap('pillars')]) {
      const ring = SHADE.concat(OPEN).map((d) => coverToward(d, map));
      expect(Math.max(...ring) - Math.min(...ring), `${map.id}는 방향에 따라 갈린다`).toBeLessThan(
        30,
      );
    }
  });
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

  /**
   * 기둥이 게임에 닿아 있다는 증거. 여기가 0에 가까워지면 이 맵은 그림만 다른 맵이다.
   *
   * **세션 48이 재는 자를 바꿨다 — 처치 수에서 화살 그 자체로.** 그전까지 이 검사는
   * "같은 씨앗의 처치가 빈 뜰보다 5% 넘게 줄어든다"였는데, 세션 48이 적의 시야를 고치자
   * **처치가 191 → 207로 올라 빈 뜰(206)과 같아졌다.** 재 보니 갈린 것은 기둥이 아니었다:
   * 내 화살이 기둥에 박히는 몫은 **0.683 → 0.696으로 그대로**이고, 늘어난 처치는
   * **기둥 뒤에 서서 쏘던 적이 걸어 나와 서게 된 몫**이다. 즉 그 5%는 이 맵이 하는 일이
   * 아니라 적의 버릇이었고, 처치 수는 그것까지 함께 재고 있었다.
   *
   * 화살을 직접 세면 그 둘이 섞이지 않는다. 실측 — 빈 뜰 0.000 · 기둥 뜰 0.696 · 그늘 뜰 0.486
   * (그늘 뜰이 절반쯤인 것은 기둥이 셋이라 그렇다. 맵의 모양이 그대로 값에 나온다).
   */
  it('기둥이 내 화살을 실제로 먹는다', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 20260909 + i);
    const eatenShare = (m: ArenaMap): number =>
      median(
        seeds.map((seed) => {
          const r = playMatch(seed, 600, walkToNearestCore, undefined, m);
          return r.eatenMine / (r.eatenMine + r.hits);
        }),
      );
    const open = eatenShare(DEFAULT_MAP);
    const withPillars = eatenShare(map);
    const shade = eatenShare(findMap('shade'));
    console.log(
      `내 화살이 기둥에 박힌 몫 — 빈 뜰 ${open.toFixed(3)} · ` +
        `기둥 뜰 ${withPillars.toFixed(3)} · 그늘 뜰 ${shade.toFixed(3)}`,
    );
    expect(open, '기둥이 없는 맵에서 화살이 먹혔다').toBe(0);
    expect(withPillars, '기둥이 화살을 먹지 않는다 — 그림만 다른 맵이다').toBeGreaterThan(0.25);
    expect(shade, '그늘 뜰의 기둥이 화살을 먹지 않는다').toBeGreaterThan(0.15);
  });
});

/**
 * **기둥 뒤에 숨어 서도 화살은 몸에 꽂힌다** (DESIGN 5번 · 10번).
 *
 * 세션 47이 찾은 고장이다: 기둥 뒤에 서면 활잡이가 기둥에 화살을 먹이며 제자리에 서서,
 * 손을 놓고도 **120~134초**를 버텼다(트인 자리 40초). 맵 하나가 그 자리에서만
 * DESIGN 5번("가만히 서 있으면 쓰러진다")을 세 배로 무디게 만든 셈이다.
 * 고친 것은 적 쪽이다 — 보이지 않으면 겨누지 않고 **보이는 자리로 걸어간다**
 * (`systems/enemyAi.ts`). 한 프레임의 규칙은 `tests/enemies.test.ts`가 지킨다.
 *
 * **시간이 아니라 피격률에 선을 긋는다.** "여기 숨으면 몇 초 사는가"는 자리를 1cm만 옮겨도
 * 41 → 120초로 튀고(세션 48이 밟았다), 오래 사는 큰 몫은 숨은 것이 아니라 **몰려온 적을
 * 눕혀 자란 것**이다. `arrowHits / enemyShots`는 "겨눠서 쏜 것 중 몇 발이 몸에 꽂혔는가"만
 * 남기므로 자란 몫이 섞이지 않는다(세션 42가 세운 자와 같은 자다).
 */
describe('가림 — 기둥 뒤에 숨어 서도 화살은 몸에 꽂힌다 (씨앗 20개)', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);

  /** 기둥 바로 뒤(벽 쪽)에 몸을 붙여 선 자리. 가장 깊은 그늘이 거기 있다. */
  const behind = (pillar: Obstacle): { x: number; y: number } => {
    const away = Math.hypot(pillar.x, pillar.y);
    const reach = (away + pillar.radius + PLAYER.radius + 0.7) / away;
    return { x: pillar.x * reach, y: pillar.y * reach };
  };

  /** 그 자리에 손을 놓고 서 있는 스무 판. */
  const standAt = (map: ArenaMap, at: { x: number; y: number }) =>
    SEEDS.map((seed) => {
      const world = new World({ seed, map });
      world.player.pos = { x: at.x, y: at.y };
      play(world, 60 * 180, () => IDLE);
      return {
        elapsed: world.elapsed,
        rate: world.enemyShots > 0 ? world.arrowHits / world.enemyShots : 1,
        eaten: world.enemyShots > 0 ? world.eatenTheirs / world.enemyShots : 0,
      };
    });

  for (const map of MAPS.filter((m) => m.obstacles.length > 0)) {
    it(`${map.name} — 어느 기둥 뒤에 서도 트인 자리만큼 맞는다`, () => {
      const openGround = median(standAt(map, { x: 0, y: 0 }).map((r) => r.rate));
      for (const pillar of map.obstacles) {
        const at = behind(pillar);
        const rows = standAt(map, at);
        const rate = median(rows.map((r) => r.rate));
        const eaten = median(rows.map((r) => r.eaten));
        console.log(
          `  ${map.name} 기둥(${pillar.x},${pillar.y}) 뒤 — 피격률 ${rate.toFixed(3)} ` +
            `(한복판 ${openGround.toFixed(3)}) · 기둥이 먹은 적 화살 ${eaten.toFixed(3)} · ` +
            `버틴 시간 ${median(rows.map((r) => r.elapsed)).toFixed(0)}초`,
        );
        // 실측 0.80~0.95(한복판 0.59). 고치기 전 같은 자리가 0.27~0.54였다.
        // 선은 세션 42가 트인 자리에 그어 둔 것과 같은 0.35다 — 숨어도 그만큼은 맞는다.
        expect(rate, `${map.id}의 기둥(${pillar.x},${pillar.y}) 뒤가 요새다`).toBeGreaterThan(0.35);
        // 적이 기둥에 대고 쏘고 있으면 여기가 쌓인다. 실측 0.000(고치기 전 0.25~0.50).
        expect(eaten, `${map.id}에서 적이 기둥에 화살을 먹이고 있다`).toBeLessThan(0.15);
      }
    });
  }
});

/**
 * **벽을 등지고 서도 요새가 되지 않는다** (세션 49 · DESIGN 5번 "가만히 서 있으면 쓰러진다").
 *
 * 기둥 그늘을 닫고 나서(세션 48) 남아 있던 마지막 요새다. **기둥이 하나도 없는 빈 뜰에서도**
 * 벽 앞 한 자리에 손을 놓고 서면 120초를 버텼다(한복판 40초). 가림이 아니었다 —
 * 벽을 등지면 적이 반쪽에서만 오고, **쓰러진 적이 맵에 못 박힌 제자리로 돌아가느라**
 * 한 번 눕힐 때마다 20~30m를 걸어야 했다. 고친 자리는 `World.pickRespawnSpot`이다.
 *
 * **자는 시간이 아니라 `초당 날아오는 적 화살`이다.** 세션 47·48이 두 번 확인했듯이
 * 버틴 시간은 자리를 1cm만 옮겨도 세 배로 튄다(같은 고리에서 30도 120초 · 36도 78초).
 * 날아온 화살 수는 한 판 내내 쌓이는 값이라 판을 가로질러 평균이 난다.
 * 실측(한복판 대비 · 씨앗 12개 중앙값): 여섯 방향 열여덟 자리 중 **가장 순한 자리가
 * 고치기 전 0.40(빈 뜰 90도) · 고친 뒤 0.69**다. 전체 폭은 0.40~0.76 → 0.69~0.86.
 *
 * **여섯 방향을 다 재는 이유**: 맵마다 적이 처음 서는 쪽이 다르므로 어느 한 방향만 재면
 * 그 맵에서 가장 순한 자리를 고르게 된다. 고리는 벽에 붙어 선 자리(`RETREAT` 23m)다.
 */
describe('벽 — 등지고 서도 적이 오는 양이 반으로 줄지 않는다 (씨앗 12개)', () => {
  const SEEDS = Array.from({ length: 12 }, (_, i) => 20260909 + i);
  const BEARINGS = [30, 90, 150, 210, 270, 330];

  /** 그 자리에 손을 놓고 서서, 초당 몇 발이 날아왔는지. */
  const incoming = (map: ArenaMap, at: { x: number; y: number }): number =>
    median(
      SEEDS.map((seed) => {
        const world = new World({ seed, map });
        world.player.pos = { x: at.x, y: at.y };
        play(world, 60 * 180, () => IDLE);
        return world.enemyShots / world.elapsed;
      }),
    );

  for (const map of MAPS) {
    it(`${map.name} — 어느 방향으로 물러나도 한복판만큼 날아온다`, () => {
      const open = incoming(map, { x: 0, y: 0 });
      const rows = BEARINGS.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const at = { x: Math.cos(a) * RETREAT, y: Math.sin(a) * RETREAT };
        return { deg, ratio: incoming(map, at) / open };
      });
      console.log(
        `  ${map.name.padEnd(6)} 한복판 초당 ${open.toFixed(2)}발 · 벽 앞 비 ` +
          rows.map((r) => `${r.deg}도 ${r.ratio.toFixed(2)}`).join(' · '),
      );
      for (const row of rows) {
        // 선은 0.6이다. 고치기 전이면 세 맵이 전부 걸린다(가장 순한 자리 0.40 · 0.52 · 0.51).
        expect(row.ratio, `${map.id}의 ${row.deg}도 벽 앞이 요새다`).toBeGreaterThan(0.6);
      }
    });
  }
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
