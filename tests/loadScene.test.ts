import { describe, expect, it } from 'vitest';
import { ARENA, CORE, ENEMY } from '../src/data/config';
import { LOAD_ARROWS, LOAD_ENEMIES, LoadScene, loadSceneEnemies } from './support/loadScene';

const DT = 1 / 60;

/**
 * 성능 측정(`npm run perf`)이 쓰는 장면이 실제로 부하를 거는지 본다.
 * 장면이 조용히 비어도 측정은 "빠르다"고 통과하기 때문에, 그쪽이 아니라
 * 이쪽에서 부하 자체를 매번 확인한다.
 */
describe('부하 장면', () => {
  it('DESIGN이 말한 만큼 세운다 — 적 20 · 투사체 60', () => {
    const scene = new LoadScene();
    expect(scene.world.enemies.length).toBe(LOAD_ENEMIES);

    scene.replenish();
    expect(scene.aliveEnemies).toBe(LOAD_ENEMIES);
    expect(scene.world.arrows.length).toBe(LOAD_ARROWS);
  });

  it('플레이어가 쏜 화살은 그대로 둔다 (부하는 60개 "이상")', () => {
    // 플레이어도 계속 쏘므로 화살이 60개를 넘길 수 있다.
    // 넘친 것을 지우면 실제보다 가벼운 장면을 재게 된다 — 그냥 둔다.
    const scene = new LoadScene();
    for (let i = 0; i < 120; i += 1) {
      scene.replenish();
      scene.world.step(scene.nextInput(), DT);
    }
    scene.replenish();
    expect(scene.world.arrows.length).toBeGreaterThanOrEqual(LOAD_ARROWS);
  });

  it('오래 돌려도 부하가 줄지 않는다', () => {
    const scene = new LoadScene();
    for (let i = 0; i < 600; i += 1) {
      scene.replenish();
      expect(scene.aliveEnemies).toBe(LOAD_ENEMIES);
      expect(scene.world.arrows.length).toBeGreaterThanOrEqual(LOAD_ARROWS);
      scene.world.step(scene.nextInput(), DT);
    }
    // 화살이 실제로 적을 맞히고 있어야 충돌 판정까지 재는 것이다.
    expect(scene.world.hits).toBeGreaterThan(0);
  });

  it('경험치 코어도 부하에 포함된다', () => {
    // 3번에서 코어가 붙었다. 적이 계속 쓰러지므로 코어는 상한 가까이 차 있어야 한다 —
    // 코어가 0인 장면을 재고 "빠르다"고 말하지 않기 위한 확인이다.
    const scene = new LoadScene();
    let minCores = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 1200; i += 1) {
      scene.replenish();
      scene.world.step(scene.nextInput(), DT);
      if (i > 400) minCores = Math.min(minCores, scene.world.cores.length);
    }
    expect(minCores).toBeGreaterThanOrEqual(CORE.maxAlive / 2);
    expect(scene.world.cores.length).toBeLessThanOrEqual(CORE.maxAlive);
  });

  it('적은 전부 아레나 안에 선다', () => {
    for (const pos of loadSceneEnemies()) {
      expect(Math.hypot(pos.x, pos.y)).toBeLessThanOrEqual(ARENA.radius - ENEMY.radius);
    }
  });

  it('부하 장면의 플레이어는 쓰러지지 않는다 (빈 step을 재지 않기 위해)', () => {
    // 적 20마리가 동시에 쏘면 실제로는 금방 죽는다. 죽은 World의 step()은 빈 함수라
    // 그때부터의 측정은 "아무것도 재지 않은 0ms"가 된다.
    const scene = new LoadScene();
    for (let i = 0; i < 1800; i += 1) {
      scene.replenish();
      scene.world.step(scene.nextInput(), DT);
    }
    expect(scene.world.defeated).toBe(false);
    expect(scene.world.elapsed).toBeGreaterThan(25);
  });
});
