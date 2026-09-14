/**
 * **적을 눈으로 볼 수 있는가**(`tools/enemy-shot.mjs`).
 *
 * 왜 검사로 두는가: 세션 51이 폭탄병을 넣었을 때 게임은 멀쩡히 그 적을 그렸지만
 * **도구는 세 종류만 알고 있었다.** 그래서 새 적을 가까이서 찍을 방법이 없었고,
 * 어느 검사도 그 사실을 말해 주지 않았다 — 도구는 타입 검사가 닿지 않는 `.mjs`이고,
 * `npm run qa`는 판을 처음부터 돌리므로 특정 적이 화면에 잡히는지가 운이다
 * (그 도구를 따로 만든 이유가 그것이다 — `enemy-shot.mjs` 머리말).
 *
 * 지시서 ⑥("화면이 있는 것을 만들면 실행해서 스크린샷을 찍고 그 이미지를 직접 읽어라")은
 * **찍을 수 있을 때만** 지킬 수 있는 규칙이다. 그러니 종류가 하나 늘면 여기가 먼저 걸린다.
 *
 * `.mjs`인 이유: 이 도구는 `.mjs`라 `node:fs`가 필요한데, `tests/`의 `.ts`는
 * `types: ["vite/client"]`로 묶여 있어 node 타입이 없다(`tsconfig.json`).
 * 도구를 재는 검사가 `.mjs`인 것은 `toolLock`·`stallReason`과 같은 자리다.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENEMY_KINDS } from '../src/render/models.ts';

/** 도구가 아는 종류. 가져다 쓸 수 없는 자리라(위) 적힌 목록을 읽는다. */
function knownKinds() {
  const source = readFileSync('tools/enemy-shot.mjs', 'utf8');
  const line = /^const KINDS = \[(.*)\];$/m.exec(source);
  expect(line, 'tools/enemy-shot.mjs에서 `const KINDS = [...]` 줄을 못 찾았다').not.toBeNull();
  return [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('적을 찍는 도구', () => {
  it('적 종류를 하나도 빠뜨리지 않는다', () => {
    // 되돌려 보려면 `KINDS`에서 하나를 지워 보라 — 그 적은 그날부터 못 찍힌다.
    expect(knownKinds().slice().sort()).toEqual(ENEMY_KINDS.slice().sort());
  });

  it('게임에 없는 종류를 알고 있지 않다', () => {
    // 위 검사가 함께 잡지만, 깨졌을 때 읽히는 이야기가 다르다 —
    // 이쪽이 걸리면 적이 사라졌는데 도구만 남은 것이다(그 도구는 조용히 아무것도 안 찍는다).
    for (const kind of knownKinds()) expect(ENEMY_KINDS).toContain(kind);
  });
});
