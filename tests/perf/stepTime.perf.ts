import { describe, expect, it } from 'vitest';
import { LOAD_ARROWS, LOAD_TARGETS, LoadScene } from '../support/loadScene';

const DT = 1 / 60;
/** 60fps 한 프레임의 전체 예산(ms). 시뮬레이션은 이 중 일부만 써야 한다. */
const FRAME_BUDGET_MS = 1000 / 60;
/**
 * 합격선 ①: `World.step()` 한 번의 상한(ms). 프레임 예산의 1/8.
 * 나머지 7/8은 렌더와 브라우저 몫으로 남긴다. DESIGN의 60fps 목표에서 온 선이다.
 */
const STEP_BUDGET_MS = FRAME_BUDGET_MS / 8;
/**
 * 합격선 ②: 회귀 감시선(ms).
 *
 * ①만 두면 너무 헐겁다 — 실제 측정값(중앙값 0.015ms 안팎)의 100배가 느려져도
 * ①은 통과한다. 그래서 실측값의 20배쯤에 선을 하나 더 둔다.
 * 이건 "빠른가"가 아니라 "구조가 바뀌었나"를 보는 선이다.
 * 화살↔대상 전수 비교(60×20)보다 나쁜 것이 들어오면 여기서 먼저 걸린다.
 *
 * 기계가 바뀌어 이 선이 실제로 좁으면, 임의로 올리지 말고
 * 새 기계의 실측값을 STATUS.md에 적고 함께 올릴 것.
 */
const REGRESSION_GUARD_MS = 0.3;

const WARMUP_STEPS = 400;
const MEASURED_STEPS = 2000;

function quantile(sorted: readonly number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index] ?? 0;
}

describe(`World.step() 처리 시간 — 적 ${LOAD_TARGETS} · 투사체 ${LOAD_ARROWS}`, () => {
  it('한 스텝이 프레임 예산 안에 들어온다', () => {
    const scene = new LoadScene();

    // 준비 운동. JIT가 아직 뜨겁지 않은 첫 수백 스텝은 실제 플레이의 시간이 아니다.
    for (let i = 0; i < WARMUP_STEPS; i += 1) {
      scene.replenish();
      scene.world.step(scene.nextInput(), DT);
    }

    const samples: number[] = [];
    let minAliveTargets = Number.POSITIVE_INFINITY;
    let minArrows = Number.POSITIVE_INFINITY;

    for (let i = 0; i < MEASURED_STEPS; i += 1) {
      // 부하를 되돌리는 시간은 게임의 시간이 아니므로 측정 밖에 둔다.
      scene.replenish();
      const input = scene.nextInput();
      minAliveTargets = Math.min(minAliveTargets, scene.aliveTargets);
      minArrows = Math.min(minArrows, scene.world.arrows.length);

      const start = performance.now();
      scene.world.step(input, DT);
      samples.push(performance.now() - start);
    }

    // 텅 빈 장면을 재고 "빠르다"고 말하는 일이 없게, 부하가 실제로 걸렸는지 먼저 본다.
    expect(minAliveTargets).toBe(LOAD_TARGETS);
    expect(minArrows).toBeGreaterThanOrEqual(LOAD_ARROWS);

    const sorted = [...samples].sort((a, b) => a - b);
    const median = quantile(sorted, 0.5);
    const p95 = quantile(sorted, 0.95);
    const worst = sorted[sorted.length - 1] ?? 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const pct = (ms: number): string => `${((ms / FRAME_BUDGET_MS) * 100).toFixed(2)}%`;

    console.log(
      [
        '',
        `  부하 장면: 적 ${LOAD_TARGETS}마리(전부 살아 있음) · 투사체 ${LOAD_ARROWS}개 · ${MEASURED_STEPS} 스텝`,
        `  프레임 예산(60fps): ${FRAME_BUDGET_MS.toFixed(2)} ms`,
        `  중앙값: ${median.toFixed(4)} ms  (프레임 예산의 ${pct(median)})`,
        `  평균  : ${mean.toFixed(4)} ms`,
        `  p95   : ${p95.toFixed(4)} ms  (${pct(p95)})`,
        `  최악  : ${worst.toFixed(4)} ms  (${pct(worst)})`,
        `  합격선①: ${STEP_BUDGET_MS.toFixed(2)} ms (프레임 예산의 1/8)`,
        `  합격선②: ${REGRESSION_GUARD_MS.toFixed(2)} ms (회귀 감시선)`,
        '',
        '  주의: 이 수치는 시뮬레이션(계산)만이다. 렌더는 포함하지 않는다.',
        '  또한 개발용 맥에서 잰 값이라 중급 스마트폰의 fps를 뜻하지 않는다.',
        '',
      ].join('\n'),
    );

    // 중앙값으로 판정한다. 최악값은 GC나 다른 프로세스에 튀어서 기준이 못 된다.
    expect(median).toBeLessThan(STEP_BUDGET_MS);
    // p95까지 예산을 넘으면 그건 튄 게 아니라 느린 것이다.
    expect(p95).toBeLessThan(STEP_BUDGET_MS);
    expect(median).toBeLessThan(REGRESSION_GUARD_MS);
  });
});
