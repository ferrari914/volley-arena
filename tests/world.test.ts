import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import { AIM, ENEMY, PLAYER } from '../src/data/config';
import type { FrameInput } from '../src/core/World';

const DT = 1 / 60;
const idle: FrameInput = { move: { x: 0, y: 0 }, aim: null };

function run(world: World, seconds: number, input: FrameInput = idle): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) world.step(input, DT);
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

  it('체력이 다하면 판이 끝나고 시간이 멈춘다', () => {
    const world = new World();
    for (let i = 0; i < 60 * 120 && !world.defeated; i += 1) world.step(idle, DT);
    expect(world.defeated).toBe(true);
    expect(world.isPaused).toBe(true);

    // 쓰러진 뒤에는 무엇을 넣어도 아무 일도 일어나지 않는다.
    const frozen = { elapsed: world.elapsed, kills: world.kills, pos: { ...world.player.pos } };
    for (let i = 0; i < 300; i += 1) world.step({ move: { x: 1, y: 0 }, aim: null }, DT);
    expect(world.elapsed).toBe(frozen.elapsed);
    expect(world.kills).toBe(frozen.kills);
    expect(world.player.pos).toEqual(frozen.pos);
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
