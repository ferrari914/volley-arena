import { describe, it } from 'vitest';
import { BURST } from '../../src/data/config';
import { UPGRADE_CARDS } from '../../src/data/upgrades';
import { playMatch, walkToNearestCore, circleShield, backOffBomber, median } from '../support/match';
import type { PlayerStats } from '../../src/entities/types';

/** 임시 측정판 — 파열의 값을 고르고 나면 지운다(세션 60). */
const SEEDS = Array.from({ length: 240 }, (_, i) => 20260909 + i);
const SHORTEST = 150;

const burstCard = UPGRADE_CARDS.find((c) => c.id === 'burst')!;
const setRadius = (r: number): void => {
  (burstCard.add as Partial<Record<keyof PlayerStats, number>>).burstRadius = r;
};
const setDamage = (d: number): void => {
  (BURST as { damage: number }).damage = d;
};

function probe(label: string, input: typeof walkToNearestCore): void {
  let dead = 0;
  let bursts = 0;
  let hits = 0;
  let kills = 0;
  let picked = 0;
  let cards = 0;
  const lengths: number[] = [];
  for (const seed of SEEDS) {
    const r = playMatch(seed, SHORTEST, input);
    if (r.defeated) dead += 1;
    bursts += r.burstsFired;
    hits += r.burstHits;
    kills += r.kills;
    cards += r.cards.length;
    picked += r.cards.filter((c) => c === 'burst').length;
    lengths.push(r.elapsed);
  }
  console.log(
    `  ${label.padEnd(26, ' ')} 꼬리 ${String(dead).padStart(3)}/${SEEDS.length} · ` +
      `터짐 ${(bursts / SEEDS.length).toFixed(1)}회/판 · 깎음 ${(hits / Math.max(bursts, 1)).toFixed(2)}명/터짐 · ` +
      `처치 ${(kills / SEEDS.length).toFixed(1)} · 파열 고른 몫 ${((picked / cards) * 100).toFixed(1)}% · 중앙 ${median(lengths).toFixed(0)}초`,
  );
}

describe('파열 값 고르기 (임시)', () => {
  it('반지름과 피해를 흔들어 본다', () => {
    const walk = walkToNearestCore;
    const circle = backOffBomber(circleShield);
    for (const [r, d] of [
      [2.2, 1],
      [2.2, 2],
      [3.4, 1],
      [3.4, 2],
      [4.5, 2],
      [0, 1],
    ] as const) {
      setRadius(r);
      setDamage(d);
      probe(`걷는 사람 r${r} d${d}`, walk);
      probe(`도는 사람 r${r} d${d}`, circle);
    }
    setRadius(2.2);
    setDamage(1);
  });
});
