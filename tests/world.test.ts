import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import { AIM, ARROW, CHARGER, CORE, ENEMY, PLAYER, REVIVE } from '../src/data/config';
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
    // 돌진형 하나만 세운다. 5m면 곧바로 웅크리고, 그 뒤에 몸이 날아온다.
    const world = new World({ enemies: [{ x: 5, y: 0, kind: 'charger' }] });
    for (let i = 0; i < 60 * 3 && world.player.hp === PLAYER.maxHp; i += 1) world.step(idle, DT);

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
