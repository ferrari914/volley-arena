import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **자 검사 — 밸런스 선을 씨앗 하나로 재지 않는다.**
 *
 * 같은 병을 세 바퀴가 고쳤다. 세션 40이 `가장 긴 판도 6분을 넘지 않는다`와
 * `도는 사람의 가장 짧은 판`을 고쳤고(둘 다 180판 중 한 판이 정하고 있었다),
 * 세션 41이 `서 있으면 1분 안에 쓰러진다`를 고쳤다 — 그것은 아예 **한 판**만 재고 있었다.
 * 셋 다 통과하고 있었기 때문에 아무도 울지 않았고, 세 바퀴를 들여 사람이 직접 찾아냈다.
 *
 * 사람이 매번 찾을 수는 없으므로 **가장 눈에 안 띄는 입구 하나**를 기계가 막는다:
 * 씨앗을 안 적은 `new World()`는 늘 같은 한 판(기본 씨앗 20260909)이다.
 * 한 프레임짜리 단위 검사에서는 그것으로 충분하지만, **판 길이를 재서 선과 견주는 자리**에
 * 쓰이면 그 선은 게임이 아니라 씨앗 하나의 운을 재게 된다.
 *
 * **이 검사가 못 잡는 것**: 씨앗을 여럿 돌리면서 극단값(최장·최단)에 선을 거는 쪽은
 * 여기서 걸리지 않는다. 그쪽은 세션 40이 STATUS에 규칙으로 적어 두었다
 * ("밸런스 선이 한두 판 차이로 깨지면 값을 옮기기 전에 씨앗 블록을 바꿔 두 번 더 재라").
 */
const BARE_WORLD = /new World\(\s*\)/;

/**
 * 주석을 걷어낸 소스. 걷어내지 않으면 **이 검사를 설명하는 주석 자체가 걸린다** —
 * 아래 `progression.test.ts`의 세션 41 주석에 `new World()`라는 글자가 들어 있다.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 파일 하나를 top-level `describe(` 자리에서 잘라 묶음별로 본다. */
function blocks(source) {
  return source
    .split(/^describe\(/m)
    .slice(1)
    .map((body) => ({ title: body.slice(0, body.indexOf('\n')).trim(), body }));
}

function read(relative) {
  return stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
}

describe('자 검사 — 밸런스 선은 씨앗 하나로 재지 않는다', () => {
  it('`밸런스` 묶음 안에서 씨앗 없이 World를 세우지 않는다', () => {
    const offenders = blocks(read('./progression.test.ts'))
      .filter((b) => /^['"`]밸런스/.test(b.title))
      .filter((b) => BARE_WORLD.test(b.body))
      .map((b) => b.title);
    expect(offenders, `씨앗 없는 new World()가 든 밸런스 묶음: ${offenders.join(' · ')}`).toEqual(
      [],
    );
  });

  it('밸런스 표(`npm run perf`)는 파일 전체가 씨앗을 적는다', () => {
    // 이 파일은 통째로 밸런스를 재는 자다. 묶음 밖(모듈 꼭대기의 도우미)에서 새는 것이
    // 실제로 있었다 — 세션 41이 고친 `standing()`이 거기 있었다.
    const source = read('./perf/balance.perf.ts');
    expect(BARE_WORLD.test(source), 'tests/perf/balance.perf.ts에 씨앗 없는 new World()가 있다').toBe(
      false,
    );
  });
});
