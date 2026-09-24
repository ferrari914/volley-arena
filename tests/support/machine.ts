/**
 * **기계가 굶고 있는지를 재는 자.** 게임은 재지 않는다.
 *
 * 왜 있는가 — 같은 고장을 세 번 겪었다(PROMPT ⑥: 두 번 나오면 검사로 만든다).
 * `src/`가 한 줄도 안 바뀌었는데 `npm test`가 빨개진 일이 세 번이고, 세 번 다 **시간 초과**였다.
 * 그때마다 한 바퀴를 "게임이 깨진 것인가 기계가 느린 것인가"를 가리는 데 썼고, 세 번 다 기계였다.
 *   - 세션 74: 기본 한도 5초에서 겪었다 → 60초로 물렸다.
 *   - 세션 90: 60초에서 또 겪었다(`tests/maps.test.ts`가 36초 → **123초**) → 300초로 물렸다.
 *   - 세션 98(바퀴 #241): **300초에서 또 겪었다.** 두 파일이 시간 초과로 빨개졌고 한 바퀴가
 *     945초를 썼다(평소 38초). 그런데 **따로 돌리면 둘 다 통과한다**(36.6초 · 11.2초).
 *     굶은 정도가 값으로 남았다 — 일꾼이 **12.8분 동안 CPU를 20.7초밖에 못 썼다(2.7%)**.
 *
 * **그래서 한도를 또 물리지 않는다.** 벽시계로 그은 선은 기계가 바쁘면 언제든 다시 넘어간다 —
 * 5초·60초·300초가 차례로 그랬다(`vitest.config.ts`의 머리말이 그 내력이다).
 * 물리는 대신 **넘어간 까닭을 기계가 스스로 말하게 한다.**
 *
 * 무엇을 재는가 — 정해진 양의 계산을 하고 **그동안 CPU를 실제로 얼마나 얻었는지**를 본다.
 * 한가한 기계면 벽시계와 CPU 시간이 거의 같아 몫이 1에 가깝고, 굶은 기계면 벽시계만 늘어나
 * 몫이 0으로 간다(위의 0.027이 그 값이다). **몫이라서 기계마다 다른 기준값을 박아 둘 필요가 없다** —
 * 빠르든 느리든 제 CPU를 온전히 쓰고 있으면 1 근처다. CPU를 뺏겨서든(다른 프로세스)
 * 막혀서든(스왑·디스크) 못 얻으면 똑같이 떨어지므로, 둘을 가리지 않고 한 값으로 잡는다.
 *
 * **[세션 117 덧붙임] 위 한 줄은 맞지만 그것만으로는 모자란다 — 이 자가 못 보는 고장이 하나 있다.**
 * "제 CPU를 온전히 쓰고 있으면 몫이 1 근처다"는 참이다. 다만 **그 CPU 1초가 하는 일의 양이
 * 코어에 따라 세 배 다르다.** 이 기계(Apple M4)는 코어 10개가 성능 4 + 효율 6으로 갈리고,
 * 효율 코어는 밀려난 것이 아니라 온전한 코어 하나다 — 그래서 **몫이 1.00인데 같은 검사가
 * 3.1배 걸린다.** 세션 117이 `/usr/bin/time`으로 잡은 판이 그렇다:
 * `real 41.22 · user 40.74 · sys 0.68`(몫 1.00)인데 벽시계는 평소의 1.7배였다.
 * **그러니 이 자가 'ok'라고 답해도 그 바퀴의 초를 앞 기록과 나란히 놓으면 안 된다.**
 * 그쪽을 보는 자는 `tests/support/coreSpeed.ts`이고, 판정은 `[코어]` 줄로 찍힌다.
 */

/** 이 아래로는 벽시계가 계산량의 두 배를 넘는다. 아직 빨갛게 하지는 않고 알리기만 한다. */
export const WARN_SHARE = 0.5;

/**
 * 이 아래로는 벽시계가 계산량의 예닐곱 배가 된다. 이쯤이면 그 바퀴의 표는 게임이 아니라
 * 기계를 잰 것이므로 통과로 읽히게 두지 않는다.
 * 선을 0.15에 둔 까닭: 실제로 겪은 유일한 사건이 0.027이고(세션 98), 한편 CPU를 40갈래로
 * 나눠 써서 load 22까지 올려 본 기계는 이 선 위에 있었다. 곧 **평범하게 바쁜 기계는 넘지 않고,
 * 진짜로 굶은 기계만 넘는다.**
 */
export const STARVED_SHARE = 0.15;

export type MachineVerdict = 'ok' | 'busy' | 'starved';

/** 몫 하나를 보고 무엇이라 부를지 정한다. 재는 일과 판단하는 일을 나눠 둬야 판단을 검사할 수 있다. */
export const verdictOf = (share: number): MachineVerdict => {
  if (share < STARVED_SHARE) return 'starved';
  if (share < WARN_SHARE) return 'busy';
  return 'ok';
};

/** 사람이 읽을 한 줄. 몫과 '벽시계가 몇 배로 늘어나는가'를 함께 적는다. */
export const describeShare = (share: number): string =>
  `CPU 몫 ${(share * 100).toFixed(1)}% (벽시계가 계산량의 ${(1 / share).toFixed(1)}배)`;

/**
 * 정해진 양의 계산. 값은 버리지만 최적화로 통째로 사라지지 않게 돌려준다.
 * 3억 번이 이 기계에서 약 160ms다 — 한 번이 너무 짧으면 CPU 시간의 눈금과 타이머 오차에
 * 묻혀 몫이 제멋대로 나온다(20ms로는 재지 못한다).
 */
const spin = (rounds: number): number => {
  let acc = 0;
  for (let i = 0; i < rounds; i += 1) acc += Math.sqrt(i % 1024);
  return acc;
};

/**
 * 이 저장소는 `@types/node`를 넣지 않는다(DESIGN: 의존성이 적을수록 루프가 코드를 파악하기 쉽다 ·
 * tsconfig의 `types`가 `vite/client` 하나다). CPU 시간은 node에만 있으므로
 * **쓰는 만큼만** 여기서 이름을 붙인다. 값을 만들지 않는 선언이라 빌드에는 아무것도 남지 않는다.
 */
declare const process: {
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number };
};

/** 한 번 재서 'CPU 시간 ÷ 벽시계' 몫을 돌려준다. 1에 가까울수록 CPU를 온전히 얻은 것이다. */
export const sampleCpuShare = (): number => {
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();
  spin(300_000_000);
  const wall = performance.now() - wallBefore;
  const used = process.cpuUsage(cpuBefore);
  return (used.user + used.system) / 1000 / wall;
};

/**
 * 세 번 재서 가장 좋은 값. 한순간 다른 일에 밀린 것으로는 빨개지지 않고,
 * **계속** 굶고 있을 때만 빨개진다. (vitest가 여러 파일을 동시에 돌리는 몫도 여기 섞인다)
 */
export const measureCpuShare = (): number =>
  Math.max(sampleCpuShare(), sampleCpuShare(), sampleCpuShare());
