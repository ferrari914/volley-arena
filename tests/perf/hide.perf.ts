import { describe, it } from 'vitest';
import { World } from '../../src/core/World';
import { MAPS } from '../../src/data/maps';
import { IDLE, play } from '../support/match';

/** 임시 측정 — 벽 앞 가장 좋은 은신처에서 손을 놓고 몇 초를 버티는가. */
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);
/** 자리를 고르는 데 쓰는 씨앗. 재는 씨앗과 겹치지 않게 둔다(고른 자리가 그 판의 운을 물려받지 않게). */
const SCOUT = [31410001, 31410002, 31410003];
const RINGS = [20, 22, 24];
const CAP = 300;

function stand(map: (typeof MAPS)[number], spot: { x: number; y: number }, seed: number): number {
  const world = new World({ seed, map });
  world.player.pos = { x: spot.x, y: spot.y };
  play(world, Math.round(60 * CAP), () => IDLE);
  return world.elapsed;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

describe('은신처', () => {
  it('벽 앞 고리를 훑는다', () => {
    for (const map of MAPS) {
      const spots: { x: number; y: number; scout: number }[] = [];
      for (const r of RINGS) {
        for (let deg = 0; deg < 360; deg += 6) {
          const a = (deg * Math.PI) / 180;
          const spot = { x: Math.cos(a) * r, y: Math.sin(a) * r };
          spots.push({ ...spot, scout: median(SCOUT.map((s) => stand(map, spot, s))) });
        }
      }
      spots.sort((a, b) => b.scout - a.scout);
      const top = spots.slice(0, 10).map((s) => ({
        ...s,
        med: median(SEEDS.map((seed) => stand(map, s, seed))),
      }));
      top.sort((a, b) => b.med - a.med);
      const center = median(SEEDS.map((seed) => stand(map, { x: 0, y: 0 }, seed)));
      const best = top[0] as (typeof top)[number];
      console.log(
        `${map.name}: 한복판 ${center.toFixed(0)}초 · 가장 좋은 자리 ` +
          `(${best.x.toFixed(1)}, ${best.y.toFixed(1)}) ${best.med.toFixed(0)}초 ` +
          `[상위 10: ${top.map((t) => t.med.toFixed(0)).join(' ')}]`,
      );
    }
  });
});
