import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import { AIM } from '../src/data/config';
import type { FrameInput } from '../src/core/World';

const DT = 1 / 60;
const idle: FrameInput = { move: { x: 0, y: 0 }, aim: null };

function run(world: World, seconds: number, input: FrameInput = idle): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) world.step(input, DT);
}

describe('World', () => {
  it('가만히 둬도 자동 조준으로 대상을 맞힌다 (버튼 없이 발사)', () => {
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
    // 대상이 하나도 없는 뒤쪽(+x)으로 조준한다.
    run(world, 1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 } });
    expect(world.lockedTarget).toBeNull();
    expect(Math.abs(world.player.facing)).toBeLessThan(0.05);
  });

  it('수동 조준을 놓으면 잠깐 뒤 자동 조준으로 돌아온다', () => {
    const world = new World();
    run(world, 1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 } });
    run(world, AIM.manualHold + 0.2);
    expect(world.lockedTarget).not.toBeNull();
  });

  it('화살은 무한정 쌓이지 않는다 (수명이 지나면 정리된다)', () => {
    const world = new World();
    run(world, 20);
    expect(world.arrows.length).toBeLessThan(20);
  });

  it('플레이어는 어떤 입력에도 아레나를 벗어나지 않는다', () => {
    const world = new World();
    for (let i = 0; i < 2000; i += 1) {
      const angle = i * 0.31;
      world.step({ move: { x: Math.cos(angle), y: Math.sin(angle) }, aim: null }, DT);
      expect(Number.isFinite(world.player.pos.x)).toBe(true);
      expect(Math.hypot(world.player.pos.x, world.player.pos.y)).toBeLessThanOrEqual(26);
    }
  });
});
