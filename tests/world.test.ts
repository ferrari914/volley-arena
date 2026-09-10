import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import {
  AIM,
  ARENA,
  ARROW,
  CHARGER,
  CORE,
  ENEMY,
  PLAYER,
  REINFORCE,
  REVIVE,
  SHIELD,
} from '../src/data/config';
import type { FrameInput } from '../src/core/World';

const DT = 1 / 60;
const idle: FrameInput = { move: { x: 0, y: 0 }, aim: null };

function run(world: World, seconds: number, input: FrameInput = idle): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) world.step(input, DT);
}

/**
 * 한 판을 쓰러질 때까지 돌린다. 먼저 돌아다니며 레벨과 카드를 쌓고, 그다음 멈춰 선다.
 * 처음부터 서 있으면 31초 만에 1레벨로 죽어서 "무엇을 잃고 무엇을 지켰는가"를 잴 수 없다.
 */
function playUntilDefeat(world: World): void {
  for (let i = 0; i < 60 * 200 && !world.defeated; i += 1) {
    // 카드가 뜨면 골라서 내린다. 안 고르면 멈춘 채로 영영 죽지 않는다.
    if (world.offer) {
      world.chooseUpgrade(world.offer.choices[0]!.card.id);
      continue;
    }
    const angle = i * DT * 1.1;
    const roaming = i < 60 * 40;
    world.step({ move: roaming ? { x: Math.cos(angle), y: Math.sin(angle) } : { x: 0, y: 0 }, aim: null }, DT);
  }
}

describe('World', () => {
  it('가만히 둬도 자동 조준으로 적을 맞힌다 (버튼 없이 발사)', () => {
    const world = new World();
    run(world, 3);
    expect(world.hits).toBeGreaterThan(0);
  });

  it('이동 입력을 주면 그 방향으로 간다', () => {
    const world = new World();
    run(world, 0.5, { move: { x: 1, y: 0 }, aim: null });
    expect(world.player.pos.x).toBeGreaterThan(1);
  });

  it('수동 조준이 자동 조준을 이긴다', () => {
    const world = new World();
    // 적이 하나도 없는 뒤쪽(+x)으로 조준한다.
    run(world, 1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 } });
    expect(world.lockedEnemy).toBeNull();
    expect(Math.abs(world.player.facing)).toBeLessThan(0.05);
  });

  it('수동 조준을 놓으면 잠깐 뒤 자동 조준으로 돌아온다', () => {
    const world = new World();
    run(world, 1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 } });
    run(world, AIM.manualHold + 0.2);
    expect(world.lockedEnemy).not.toBeNull();
  });

  it('화살은 무한정 쌓이지 않는다 (수명이 지나면 정리된다)', () => {
    const world = new World();
    run(world, 20);
    // 적이 쏘는 몫까지 세지만, 수명이 다한 것은 매 스텝 치워진다.
    expect(world.arrows.length).toBeLessThan(20);
  });

  it('적도 화살을 쏜다 (주인이 다른 화살이 같은 하늘을 난다)', () => {
    const world = new World();
    let sawEnemyArrow = false;
    let sawPlayerArrow = false;
    for (let i = 0; i < 60 * 40 && !world.defeated; i += 1) {
      world.step(idle, DT);
      for (const arrow of world.arrows) {
        if (arrow.owner === 'enemy') sawEnemyArrow = true;
        else sawPlayerArrow = true;
      }
    }
    expect(sawPlayerArrow).toBe(true);
    expect(sawEnemyArrow).toBe(true);
  });

  /**
   * DESIGN 품질 기준: "처음 하는 사람이 설명 없이 30초 안에 조작을 이해할 것".
   *
   * 처음 선 적은 전부 `fireCooldown` 0으로 태어나 **첫 프레임부터 겨눴다** —
   * 배치의 활잡이 둘이 13m(`fireRange` 15 안쪽)에 서 있어, 180판을 재니 첫 피격이
   * 3초 안에 온 판이 90판이었다(가장 이른 것 0.9초). 손을 대기도 전에 맞으면
   * 무엇에 맞았는지 알 수 없다. `ENEMY.startDelay`가 그 자리를 막는다.
   *
   * **"쏘지 않는다"가 아니라 "겨누지도 않는다"를 잰다.** 겨눔은 예고이자 멈춤이라,
   * 준비 시간 동안 겨누고 있으면 준비 시간이 끝나는 순간 화살이 나간다 — 그러면
   * 기다린 것이 아무 일도 하지 않은 것이 된다.
   */
  it('판이 시작하고 준비 시간 동안에는 아무도 겨누지 않는다 (DESIGN 품질 기준)', () => {
    const world = new World();
    const startDistances = world.enemies.map((e) => Math.hypot(e.pos.x, e.pos.y));

    run(world, ENEMY.startDelay);

    for (const enemy of world.enemies) {
      expect(enemy.aimTimer, `적 ${enemy.id}가 겨누고 있다`).toBe(0);
      expect(enemy.dashTimer, `적 ${enemy.id}가 몸을 던졌다`).toBe(0);
    }
    expect(world.arrows.some((a) => a.owner === 'enemy')).toBe(false);
    expect(world.player.hp).toBe(PLAYER.maxHp);

    // 그렇다고 멈춰 서 있지는 않는다. 다가오는 적이 보여야 무슨 게임인지 읽힌다 —
    // 얼어붙은 적 다섯은 고장으로 보인다.
    const moved = world.enemies.filter(
      (e, i) => Math.abs(Math.hypot(e.pos.x, e.pos.y) - (startDistances[i] ?? 0)) > 0.5,
    );
    expect(moved.length, '준비 시간 동안 적이 한 발짝도 움직이지 않았다').toBeGreaterThan(0);
  });

  /**
   * 준비 시간은 **예고 시간과 더해서** 뜻이 생긴다. 준비가 끝나는 순간 곧바로 아픈 것이
   * 아니라, 거기서 겨눔(활잡이 `aimTime`) 또는 웅크림(돌진형 `windup`)이 한 번 더 붙는다.
   * 그 합이 첫 대가 올 수 있는 가장 이른 시각이다 — 실측 3.0초(스무 판 × 두 사람).
   * 값을 만질 때 이 합이 3초 밑으로 내려가면 첫 2초 문제가 그대로 돌아온다.
   */
  it('첫 대가 올 수 있는 가장 이른 시각이 3초보다 이르지 않다', () => {
    const earliest = ENEMY.startDelay + Math.min(ENEMY.aimTime, CHARGER.windup);
    expect(earliest, `준비 ${ENEMY.startDelay}초 + 예고`).toBeGreaterThanOrEqual(2.9);
  });

  it('적을 쓰러뜨리려면 여러 발이 든다', () => {
    const world = new World();
    for (let i = 0; i < 600 && world.kills === 0; i += 1) world.step(idle, DT);
    expect(world.kills).toBe(1);
    // 체력이 붙었으므로 명중 수와 처치 수는 더 이상 같지 않다.
    expect(world.hits).toBeGreaterThanOrEqual(ENEMY.maxHp);
  });

  it('적의 화살이 플레이어의 체력을 깎는다', () => {
    const world = new World();
    // 가만히 서 있으면 적이 다가와 겨누고 쏜다. 그것이 이 게임의 유일한 위협이다.
    for (let i = 0; i < 60 * 30 && world.player.hp === PLAYER.maxHp; i += 1) world.step(idle, DT);
    expect(world.player.hp).toBeLessThan(PLAYER.maxHp);
    expect(world.player.hp).toBe(PLAYER.maxHp - ENEMY.arrow.damage);
  });

  it('돌진형의 몸통도 화살과 같은 무적 규칙을 지난다 (DESIGN 9번)', () => {
    // 돌진형 하나만 세운다. 5m면 준비 시간(`ENEMY.startDelay`)이 지나는 대로 웅크리고,
    // 그 뒤에 몸이 날아온다. **첫 몸통 한 대가 올 때까지 넉넉히 기다린다** —
    // 준비 시간 동안 자동 발사가 이 놈을 한 번 쓰러뜨리고 다시 서기도 하기 때문이다.
    // 여기서 재는 것은 "언제 닿는가"가 아니라 "한 번의 돌진이 몇 번 아픈가"다.
    const world = new World({ enemies: [{ x: 5, y: 0, kind: 'charger' }] });
    for (let i = 0; i < 60 * 12 && world.player.hp === PLAYER.maxHp; i += 1) world.step(idle, DT);

    // 한 번의 돌진은 딱 한 번 깎는다. 몸이 겹쳐 있는 여러 프레임 동안 계속 깎이면
    // 예고 한 번에 판이 끝난다.
    expect(world.player.hp).toBe(PLAYER.maxHp - CHARGER.damage);
    expect(world.player.invulnerable).toBeGreaterThan(0);
    expect(world.player.hitFlash).toBe(1);

    const hp = world.player.hp;
    run(world, PLAYER.invulnerable - DT);
    expect(world.player.hp).toBe(hp);
  });

  it('체력이 다하면 판이 끝나고 시간이 멈춘다', () => {
    const world = new World();
    for (let i = 0; i < 60 * 120 && !world.defeated; i += 1) {
      // 카드가 뜨면 골라서 내린다. 서 있어도 코어는 쌓이므로(돌진형이 발밑까지 와서
      // 쓰러진다 — DESIGN 9번) 고르지 않으면 멈춘 채로 영영 죽지 않는다.
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step(idle, DT);
    }
    expect(world.defeated).toBe(true);
    expect(world.isPaused).toBe(true);

    // 쓰러진 뒤에는 무엇을 넣어도 아무 일도 일어나지 않는다.
    const frozen = { elapsed: world.elapsed, kills: world.kills, pos: { ...world.player.pos } };
    for (let i = 0; i < 300; i += 1) world.step({ move: { x: 1, y: 0 }, aim: null }, DT);
    expect(world.elapsed).toBe(frozen.elapsed);
    expect(world.kills).toBe(frozen.kills);
    expect(world.player.pos).toEqual(frozen.pos);
  });

  it('부활하면 그 자리에서 레벨과 카드를 유지한 채 다시 선다', () => {
    const world = new World();
    playUntilDefeat(world);
    expect(world.defeated).toBe(true);

    const before = {
      level: world.progress.level,
      stats: { ...world.stats },
      taken: [...world.takenUpgrades],
      pos: { ...world.player.pos },
      elapsed: world.elapsed,
      kills: world.kills,
    };
    expect(before.taken.length).toBeGreaterThan(0);

    expect(world.revive()).toBe(true);

    // 되돌아온 것은 몸뿐이다.
    expect(world.defeated).toBe(false);
    expect(world.isPaused).toBe(false);
    expect(world.player.hp).toBe(PLAYER.maxHp);
    expect(world.player.invulnerable).toBe(REVIVE.invulnerable);
    expect(world.revives).toBe(1);
    // 쌓아 온 것은 그대로다 — 이것이 리스폰과 부활을 가르는 유일한 차이다.
    expect(world.progress.level).toBe(before.level);
    expect(world.stats).toEqual(before.stats);
    expect(world.takenUpgrades).toEqual(before.taken);
    expect(world.player.pos).toEqual(before.pos);
    expect(world.elapsed).toBe(before.elapsed);
    expect(world.kills).toBe(before.kills);

    // 그리고 다시 흐른다. 멈춘 채로 남는 것이 이 기능의 가장 나쁜 고장이다.
    run(world, 0.5);
    expect(world.elapsed).toBeGreaterThan(before.elapsed);
  });

  it('부활 직후에는 날아오던 화살도, 겨누던 적도 없다', () => {
    const world = new World();
    playUntilDefeat(world);
    expect(world.defeated).toBe(true);

    world.revive();
    expect(world.arrows.some((arrow) => arrow.owner === 'enemy')).toBe(false);
    expect(world.enemies.every((enemy) => enemy.aimTimer === 0)).toBe(true);

    // 무적이 끝나기 전에 도망칠 틈이 있어야 한다(적의 발사 지연 < 무적 시간).
    run(world, REVIVE.enemyDelay);
    expect(world.player.hp).toBe(PLAYER.maxHp);
    expect(world.player.invulnerable).toBeGreaterThan(0);
  });

  it('쓰러지지 않았으면 부활하지 않는다 (무적을 공짜로 얻지 못한다)', () => {
    const world = new World();
    run(world, 1);
    expect(world.revive()).toBe(false);
    expect(world.revives).toBe(0);
    expect(world.player.invulnerable).toBeLessThan(REVIVE.invulnerable);
  });

  it('리스폰(새 판)은 레벨도 카드도 남기지 않는다', () => {
    const played = new World();
    playUntilDefeat(played);
    expect(played.progress.level).toBeGreaterThan(1);

    // 리스폰은 World를 통째로 새로 만드는 것이다(main.ts). 되돌릴 값을 하나씩 세지 않으므로
    // 새 판이 방금 켠 게임과 같은지만 보면 된다 — 여기서 빠지는 값이 지난 판의 찌꺼기다.
    const fresh = new World();
    expect(fresh.progress.level).toBe(1);
    expect(fresh.progress.totalXp).toBe(0);
    expect(fresh.takenUpgrades).toEqual([]);
    expect(fresh.upgradeStacks).toEqual({});
    expect(fresh.kills).toBe(0);
    expect(fresh.elapsed).toBe(0);
    expect(fresh.revives).toBe(0);
    expect(fresh.defeated).toBe(false);
    expect(fresh.offer).toBeNull();
    expect(fresh.player.hp).toBe(PLAYER.maxHp);
    expect(fresh.player.pos).toEqual({ x: 0, y: 0 });
    expect(fresh.arrows).toEqual([]);
    expect(fresh.stats).toEqual({
      fireCooldown: ARROW.cooldown,
      moveSpeed: PLAYER.speed,
      magnetRadius: CORE.magnetRadius,
      xpMultiplier: 1,
      arrowCount: 1,
      pierce: 0,
      bounce: 0,
    });
  });

  it('플레이어는 자기 화살에 맞지 않는다', () => {
    // 적이 없는 아레나. 자동 발사는 조준할 것이 없어도 계속 쏘므로,
    // 화살이 총구(몸에서 0.9m)에서 생기는 이 상황이 자기 화살에 맞기 가장 쉬운 판이다.
    const world = new World({ enemies: [] });
    for (let i = 0; i < 60 * 20; i += 1) {
      // 제자리에서 방향을 계속 바꾼다 — 방금 쏜 화살 위로 걸어 들어가는 경우까지 만든다.
      world.step({ move: { x: Math.cos(i * 0.2), y: Math.sin(i * 0.2) }, aim: null }, DT);
    }
    expect(world.arrows.length).toBeGreaterThan(0);
    expect(world.player.hp).toBe(PLAYER.maxHp);
    expect(world.defeated).toBe(false);
  });

  it('플레이어는 어떤 입력에도 아레나를 벗어나지 않는다', () => {
    const world = new World();
    for (let i = 0; i < 2000 && !world.defeated; i += 1) {
      const angle = i * 0.31;
      world.step({ move: { x: Math.cos(angle), y: Math.sin(angle) }, aim: null }, DT);
      expect(Number.isFinite(world.player.pos.x)).toBe(true);
      expect(Math.hypot(world.player.pos.x, world.player.pos.y)).toBeLessThanOrEqual(26);
    }
  });
});

/**
 * DESIGN 품질 기준의 "한 판이 3~5분 안에 끝날 것"을 붙잡아 두는 장치(`REINFORCE`).
 * 판 길이가 화력의 함수가 되지 않도록, 시간이 갈수록 아레나가 무거워진다.
 *
 * 여기서는 "언제 · 몇 마리 · 어디에"만 본다. 그것이 한 판 길이에 실제로 하는 일은
 * `tests/progression.test.ts`가 씨앗 20개로 잰다.
 */
describe('World — 증원', () => {
  /** 체력을 계속 되돌리며 오래 돌린다. 증원은 분 단위라 그냥 돌리면 먼저 쓰러진다. */
  function survive(world: World, seconds: number): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      world.player.hp = world.player.maxHp;
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step(idle, DT);
    }
  }

  const layout = 5;

  it('첫 증원 전까지는 처음 배치 그대로다', () => {
    const world = new World();
    survive(world, REINFORCE.firstDelay - 5);
    expect(world.enemies).toHaveLength(layout);
  });

  it('시간이 지나면 한 마리씩 들어온다', () => {
    const world = new World();
    survive(world, REINFORCE.firstDelay + 1);
    expect(world.enemies).toHaveLength(layout + 1);
    survive(world, REINFORCE.interval);
    expect(world.enemies).toHaveLength(layout + 2);
  });

  it('무한정 늘지는 않는다 — 상한에서 멈춘다', () => {
    // 상한에 닿고도 한참 더 돌린다. 여기가 뚫리면 오래 버틴 사람의 화면에서만
    // 프레임이 무너진다(부하 측정이 잡아 둔 선은 적 20마리다).
    const world = new World();
    survive(world, REINFORCE.firstDelay + REINFORCE.interval * (REINFORCE.maxExtra + 3));
    expect(world.enemies).toHaveLength(layout + REINFORCE.maxExtra);
  });

  it('증원은 플레이어 코앞이 아니라 벽 가까이에서 걸어 들어온다', () => {
    // **플레이어를 벽에 붙여 세우고 잰다.** 가운데 서 있으면 벽 쪽 어디에 나타나도
    // 멀어서, 코앞에 나타나는 고장을 잡지 못한다. 벽에 붙으면 증원이 설 자리의
    // 5분의 1이 코앞이라, 자리를 고르는 규칙이 없으면 여기서 걸린다.
    const world = new World();
    const steps = Math.round((REINFORCE.firstDelay + REINFORCE.interval * 4) / DT);
    let seen = layout;
    for (let i = 0; i < steps; i += 1) {
      world.player.hp = world.player.maxHp;
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step({ move: { x: 1, y: 0 }, aim: null }, DT);
      while (seen < world.enemies.length) {
        const joined = world.enemies[seen]!;
        seen += 1;
        expect(Math.hypot(joined.home.x, joined.home.y)).toBeCloseTo(REINFORCE.spawnRadius, 6);
        expect(
          Math.hypot(joined.home.x - world.player.pos.x, joined.home.y - world.player.pos.y),
        ).toBeGreaterThanOrEqual(REINFORCE.minPlayerDistance);
      }
    }
    expect(seen).toBeGreaterThan(layout);
    // 벽 밖에 서지 않는다(몸 반지름까지 넣어서).
    expect(REINFORCE.spawnRadius).toBeLessThanOrEqual(ARENA.radius - ENEMY.radius);
  });

  it('세 종류가 다 섞여 들어온다 — 한 종류만 늘면 요구하는 것도 하나로 준다', () => {
    const world = new World();
    survive(world, REINFORCE.firstDelay + REINFORCE.interval * REINFORCE.maxExtra);
    const joined = world.enemies.slice(layout);
    // 표(`REINFORCE.order`)에 적힌 그대로 들어와야 한다. 표를 고치면 이 검사가 함께 움직인다.
    expect(joined.map((e) => e.kind)).toEqual([...REINFORCE.order]);
    for (const kind of ['archer', 'charger', 'shield'] as const) {
      expect(joined.filter((e) => e.kind === kind).length).toBeGreaterThan(0);
    }
  });

  it('증원으로 들어온 방패병도 방패를 들고 있다', () => {
    // 처음 배치와 증원이 다른 길로 세워지면(생성자 · updateReinforcements) 한쪽만
    // 방패를 빠뜨리기 쉽다 — 세우는 길을 `spawnEnemy` 하나로 모아 둔 이유다.
    // **들어온 그 순간에 본다.** 판을 끝까지 돌리고 나서 보면 이미 몇 대 맞은 뒤라
    // 방패를 들고 왔는지 맞아서 깎인 것인지 구별할 수 없다.
    const world = new World();
    const nth = REINFORCE.order.indexOf('shield') + 1;
    expect(nth).toBeGreaterThan(0);
    // 첫 방패병이 들어오는 시각까지만 돌린다(`survive`가 체력을 되돌려 준다 —
    // 그냥 돌리면 증원이 오기 전에 쓰러져 시계가 멈춘다).
    survive(world, REINFORCE.firstDelay + REINFORCE.interval * (nth - 1) + 1);
    const joined = world.enemies[world.enemies.length - 1];
    expect(joined?.kind).toBe('shield');
    expect(joined?.shieldHp).toBe(SHIELD.shieldHp);
  });

  it('이어하기로 살아나도 증원은 되돌아가지 않는다', () => {
    // 부활은 몸만 되돌린다(DESIGN 6번). 시계가 이어지므로 아레나도 이어져야 한다 —
    // 광고를 본 사람에게 쉬운 판을 새로 깔아 주면 이어하기가 판을 되감는 버튼이 된다.
    const world = new World();
    survive(world, REINFORCE.firstDelay + 1);
    const before = world.enemies.length;
    world.player.hp = 0;
    world.step(idle, DT);
    world.revive();
    survive(world, 1);
    expect(world.enemies.length).toBe(before);
  });
});
