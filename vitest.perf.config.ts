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
    /**
     * 한 검사에 주는 시간(ms). 기본값 5초는 여기 있는 검사에 너무 좁다.
     *
     * 밸런스 표(180판)는 이 기계에서 **4.59초**가 걸린다 — 기본 한도까지 여유가 8%뿐이라,
     * 기계가 조금만 바쁘면 **표를 다 찍어 놓고 시간 초과로 실패한다.**
     * 재는 일 자체는 씨앗이 고정된 결정적 계산이라 결과가 늘 같은데,
     * 합격 여부만 그때그때 기계 사정이 정하는 셈이다.
     *
     * 여기 있는 검사는 "얼마나 걸리는가"를 **본문에서 직접 재서 합격선과 견준다**
     * (`stepTime.perf.ts`의 프레임 예산). 그러니 벽시계로 판을 죽이는 자는 필요 없고,
     * 이 값은 영영 안 끝나는 것만 잡아내는 안전선으로 넉넉히 둔다.
     */
    testTimeout: 120_000,
  },
});
