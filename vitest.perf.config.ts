import { defineConfig } from 'vitest/config';

/**
 * 성능 측정 전용 설정. `npm run perf`가 쓴다.
 *
 * 일반 `npm test`와 분리한 이유: 시간을 재는 검사는 기계가 바쁘면 흔들린다.
 * 매번 돌려 흔들리는 것보다, 성능에 영향이 갈 만한 작업을 했을 때 따로 돌리는 편이 낫다.
 * 대신 여기서 재는 장면이 제대로 서는지는 `tests/loadScene.test.ts`가
 * `npm test`에서 매번 확인한다.
 */
export default defineConfig({
  test: {
    include: ['tests/perf/*.perf.ts'],
    // vitest 4는 통과한 테스트의 console 출력을 가로채 감춘다.
    // 여기서는 그 출력(측정 결과)이 목적이므로 가로채지 않게 한다.
    disableConsoleIntercept: true,
    // 시간을 재는 동안 다른 테스트 파일과 CPU를 나눠 쓰지 않게 한다.
    fileParallelism: false,
  },
});
