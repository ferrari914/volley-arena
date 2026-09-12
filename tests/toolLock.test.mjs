/**
 * 브라우저 도구 자물쇠(`tools/lib/lock.mjs`).
 *
 * 왜 검사가 필요한가: 이 자물쇠는 **평소에 아무 일도 하지 않는다.** 도구를 하나만 돌리면
 * 잡았다 푸는 것이 전부라, 고장 나 있어도 알아챌 길이 없다 — 그러다 정말 둘이 겹치는 날
 * (세션 33이 남긴 러너 위에 세션 34가 제 러너를 얹은 그날) 조용히 통과해 버린다.
 * 그래서 겹치는 상황을 여기서 만들어 재 둔다.
 *
 * 자물쇠 파일은 실제 자리(`logs/browser-tool.lock`)를 쓴다. 검사가 도구를 돌리는 일은 없고,
 * 끝나면 원래 있던 것을 되돌려 놓는다 — 이 검사 때문에 남의 자물쇠가 풀리면 안 된다.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireBrowserLock, BROWSER_LOCK_PATH, LOCK_BUSY_EXIT } from '../tools/lib/lock.mjs';

/** 검사가 시작할 때 남의 자물쇠가 있었으면 끝나고 그대로 돌려놓는다. */
let saved = null;

beforeEach(() => {
  mkdirSync('logs', { recursive: true });
  saved = existsSync(BROWSER_LOCK_PATH) ? readFileSync(BROWSER_LOCK_PATH, 'utf8') : null;
  if (saved !== null) unlinkSync(BROWSER_LOCK_PATH);
});

afterEach(() => {
  if (existsSync(BROWSER_LOCK_PATH)) unlinkSync(BROWSER_LOCK_PATH);
  if (saved !== null) writeFileSync(BROWSER_LOCK_PATH, saved);
});

/** 살아 있는 남의 프로세스인 척하는 자물쇠를 심는다. pid 1(launchd/init)은 늘 살아 있다. */
function seedLock(holder) {
  writeFileSync(BROWSER_LOCK_PATH, JSON.stringify(holder));
}

describe('브라우저 도구 자물쇠', () => {
  it('아무도 없으면 잡고, 풀면 자리를 비운다', () => {
    const release = acquireBrowserLock('검사');
    expect(existsSync(BROWSER_LOCK_PATH)).toBe(true);
    expect(JSON.parse(readFileSync(BROWSER_LOCK_PATH, 'utf8')).pid).toBe(process.pid);
    release();
    expect(existsSync(BROWSER_LOCK_PATH)).toBe(false);
  });

  it('살아 있는 주인이 있으면 막는다 — 겹쳐 도는 것이 이 자물쇠가 막으려는 전부다', () => {
    seedLock({ tool: '먼저 돌던 도구', pid: 1, startedAt: Date.now() - 12 * 60_000 });
    expect(() => acquireBrowserLock('나중에 온 도구')).toThrow(/이미 돌고 있다/);
    // 남의 자물쇠를 지우고 들어가지 않았는지 함께 본다.
    expect(JSON.parse(readFileSync(BROWSER_LOCK_PATH, 'utf8')).pid).toBe(1);
  });

  it('막을 때 누구인지·얼마나 됐는지·어떻게 멈추는지를 함께 적는다', () => {
    seedLock({ tool: 'npm run qa (shot.mjs)', pid: 1, startedAt: Date.now() - 12 * 60_000 });
    let message = '';
    try {
      acquireBrowserLock('나중에 온 도구');
    } catch (error) {
      message = error.message;
    }
    // "이미 돌고 있다"만 적으면 사람이 무엇을 해야 할지 모른다.
    expect(message).toContain('npm run qa (shot.mjs)');
    expect(message).toContain('pid 1');
    expect(message).toContain('12분째');
    expect(message).toContain('kill 1');
  });

  it('주인이 죽은 자물쇠는 걷어내고 넘겨받는다 — 세션이 끊기면 풀 기회가 없다', () => {
    // 있을 수 없는 pid. process.kill(pid, 0)이 ESRCH로 죽은 것을 알려 준다.
    seedLock({ tool: '끊긴 세션의 도구', pid: 2 ** 22, startedAt: Date.now() - 60_000 });
    const release = acquireBrowserLock('다음 세션');
    expect(JSON.parse(readFileSync(BROWSER_LOCK_PATH, 'utf8')).pid).toBe(process.pid);
    release();
  });

  it('내용이 깨진 자물쇠도 주인 없는 것으로 보고 넘겨받는다', () => {
    writeFileSync(BROWSER_LOCK_PATH, '{쓰다 만 것');
    const release = acquireBrowserLock('다음 세션');
    expect(JSON.parse(readFileSync(BROWSER_LOCK_PATH, 'utf8')).pid).toBe(process.pid);
    release();
  });

  it('푸는 쪽은 제 것만 푼다 — 남의 자물쇠를 지우면 그쪽이 자물쇠 없이 돈다', () => {
    const release = acquireBrowserLock('검사');
    seedLock({ tool: '그새 자리를 넘겨받은 도구', pid: 1, startedAt: Date.now() });
    release();
    expect(JSON.parse(readFileSync(BROWSER_LOCK_PATH, 'utf8')).pid).toBe(1);
  });

  it('막힌 것은 검사가 실패한 것과 다른 종료 코드다', () => {
    // 1은 "검사가 문제를 찾았다", 3은 "검사가 돌지 못했다". 로그만 보고 갈라야 한다.
    expect(LOCK_BUSY_EXIT).toBe(3);
    expect(LOCK_BUSY_EXIT).not.toBe(1);
  });
});
