/**
 * 미리보기 서버를 띄우고 내리는 자(`tools/lib/preview.mjs`).
 *
 * **왜 검사가 필요한가.** 이 자는 잘 돌 때 아무 표도 남기지 않는다 — 서버가 떴고 화면이
 * 찍혔으면 끝이다. 그래서 **서버를 안 내리고 있어도 그 바퀴는 멀쩡해 보인다.**
 * 실제로 그렇게 됐다(세션 117이 곁눈으로 봤다): 고아가 된 `vite preview` 둘이
 * **11일 12시간 · 8일 6시간** 동안 포트를 쥔 채 살아 있었다. 그리고 그 고아는
 * 다음 바퀴를 조용히 남의 서버 위에 올려놓는다(`--strictPort`에 막혀 내 서버는 죽는데
 * 고아가 대신 대답한다 — `preview.mjs` 머리말).
 *
 * **여기서 재는 것은 vite가 아니라 그 살림살이다.** 그래서 서버는 가짜로 세운다
 * (`node -e`로 띄운 http 서버 한 줄). 검사가 `npm run build`나 vite에 기대면
 * 빌드가 없는 바퀴에서 이 검사부터 빨개지는데, 그때 빨간 것은 살림살이가 아니다.
 *
 * 포트는 도구가 쓰는 수(4183·4184·4189·4191)를 피해 45xxx를 쓴다 —
 * 이 검사가 진짜 QA 서버를 걷어내는 일이 있으면 안 된다.
 */
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isOurPreview,
  listeningPids,
  processCommand,
  reapPort,
  startPreview,
} from '../tools/lib/preview.mjs';

/** 검사마다 다른 포트를 쓴다. 같은 파일 안의 검사는 차례로 돌지만, 소켓은 바로 안 놓인다. */
const PORT = { stop: 45183, orphan: 45184, foreign: 45185, dies: 45186, notMine: 45187, twice: 45188 };

/** 이 검사가 띄운 것들. 무슨 일이 나도 끝에 반드시 내린다. */
let spawned = [];

afterEach(async () => {
  for (const child of spawned) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // 이미 죽었다.
      }
    }
  }
  spawned = [];
  await new Promise((resolve) => setTimeout(resolve, 150));
});

/** 그 포트에 대답만 하는 가짜 서버. `detached`는 진짜와 같게 준다(그룹째 내려야 한다). */
function fakeServer(port) {
  const child = spawn(
    process.execPath,
    ['-e', `require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1')`],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  child.killsAsGroup = true;
  spawned.push(child);
  return child;
}

/** 그 포트가 대답할 때까지 기다린다. */
async function waitUp(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return true;
    } catch {
      // 아직.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

describe('미리보기 서버를 알아보는 눈', () => {
  // 지금 살아 있는 고아들의 실제 명령줄이다. 못 알아보면 걷어낼 수가 없다.
  const OLD = 'npm exec vite preview --port 4183 --strictPort --host 127.0.0.1';
  const OLD_CHILD =
    'node /Users/x/Projects/화살 게임 개발/node_modules/.bin/vite preview --port 4191 --strictPort --host 127.0.0.1';
  const NOW =
    '/usr/local/bin/node /Users/x/Projects/화살 게임 개발/node_modules/vite/bin/vite.js preview --port 4183 --strictPort --host 127.0.0.1';

  it('우리가 그 포트에 띄운 미리보기 서버를 알아본다 — 옛 모양(npx)도 함께', () => {
    expect(isOurPreview(OLD, 4183)).toBe(true);
    expect(isOurPreview(OLD_CHILD, 4191)).toBe(true);
    expect(isOurPreview(NOW, 4183)).toBe(true);
    expect(isOurPreview('node ./node_modules/vite/bin/vite.js preview --port=4189', 4189)).toBe(true);
  });

  it('포트가 다르면 남의 것으로 본다 — 앞자리만 같은 수에 속지 않는다', () => {
    expect(isOurPreview(OLD, 4184)).toBe(false);
    // 이것을 놓치면 `--port 41830`을 쥔 프로그램이 4183을 찾는 도구에게 죽는다.
    expect(isOurPreview('node vite.js preview --port 41830', 4183)).toBe(false);
    expect(isOurPreview(OLD, 418)).toBe(false);
  });

  it('미리보기가 아니면 남의 것으로 본다 — 죽여도 되는 것은 좁게 본다', () => {
    expect(isOurPreview('node /Users/x/server.js --port 4183', 4183)).toBe(false);
    expect(isOurPreview('node ./node_modules/vite/bin/vite.js dev --port 4183', 4183)).toBe(false);
    expect(isOurPreview('', 4183)).toBe(false);
    // 사람이 손으로 띄운 개발 서버(`npm run dev`)도 미리보기가 아니다.
    expect(isOurPreview('npm exec vite --port 4183', 4183)).toBe(false);
  });
});

describe('띄우고 내리기', () => {
  it('stop()을 부르면 포트가 비고 프로세스가 남지 않는다', async () => {
    const preview = await startPreview(PORT.stop, 10000, { spawnServer: fakeServer });
    expect(listeningPids(PORT.stop)).toContain(preview.pid);
    expect((await fetch(preview.url)).ok).toBe(true);

    await preview.stop();

    // 이 셋이 이 검사의 전부다: 포트가 비었고 · 프로세스가 죽었고 · 대답하는 것이 없다.
    expect(listeningPids(PORT.stop)).toEqual([]);
    expect(alive(preview.pid)).toBe(false);
    await expect(fetch(preview.url)).rejects.toThrow();
  });

  it('stop()을 두 번 불러도 탈이 없다 — finally가 겹쳐 도는 길이 있다', async () => {
    const preview = await startPreview(PORT.twice, 10000, { spawnServer: fakeServer });
    await preview.stop();
    await expect(preview.stop()).resolves.toBeUndefined();
  });

  it('나가는 길에 내릴 수 있게 손을 걸어 두고, 내린 뒤에는 그 손을 거둔다', async () => {
    const before = process.listenerCount('exit');
    const preview = await startPreview(PORT.stop, 10000, { spawnServer: fakeServer });
    // 이 손이 없으면 예외로 끝난 바퀴가 서버를 남긴다(`finally`가 없는 길이 있다).
    expect(process.listenerCount('exit')).toBe(before + 1);
    await preview.stop();
    // 거두지 않으면 도구 하나가 여러 번 띄울 때 손만 쌓인다.
    expect(process.listenerCount('exit')).toBe(before);
  });
});

describe('앞선 바퀴가 남긴 고아', () => {
  it('그 포트를 쥔 고아를 걷어내고 그 자리를 넘겨받는다', async () => {
    const orphan = fakeServer(PORT.orphan);
    expect(await waitUp(PORT.orphan)).toBe(true);

    // 고아의 명령줄은 vite가 아니므로, 여기서는 "우리 것"을 판정하는 눈만 갈아 끼운다
    // (그 눈 자체는 위 묶음이 실제 명령줄로 따로 잰다).
    const preview = await startPreview(PORT.orphan, 10000, {
      spawnServer: fakeServer,
      isMine: () => true,
    });

    expect(alive(orphan.pid)).toBe(false);
    expect(listeningPids(PORT.orphan)).toEqual([preview.pid]);
    await preview.stop();
  });

  it('남의 프로그램이 쥐고 있으면 죽이지 않고, 누구인지 적어서 멈춘다', async () => {
    const stranger = fakeServer(PORT.foreign);
    expect(await waitUp(PORT.foreign)).toBe(true);

    await expect(
      startPreview(PORT.foreign, 10000, { spawnServer: fakeServer, isMine: () => false }),
    ).rejects.toThrow(new RegExp(`포트 ${PORT.foreign}[\\s\\S]*죽이지 않고`));

    // 말만 하고 실제로는 죽였는지를 본다 — 여기가 이 갈래의 값이다.
    expect(alive(stranger.pid)).toBe(true);
    expect(listeningPids(PORT.foreign)).toContain(stranger.pid);
  });

  it('막을 때 그 pid와 명령줄을 함께 적는다 — 사람이 무엇을 내릴지 알아야 한다', async () => {
    const stranger = fakeServer(PORT.foreign);
    expect(await waitUp(PORT.foreign)).toBe(true);

    let message = '';
    try {
      await reapPort(PORT.foreign, { isMine: () => false });
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain(String(stranger.pid));
    expect(message).toContain(processCommand(stranger.pid).slice(0, 20));
  });
});

describe('뜬 것이 내 서버가 아닐 때', () => {
  it('서버가 뜨자마자 죽으면 기다리지 않고, 남긴 말을 함께 적는다', async () => {
    const dying = (port) => {
      const child = spawn(process.execPath, ['-e', `console.error('포트 ${port}가 이미 있다'); process.exit(7)`], {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      });
      child.killsAsGroup = true;
      spawned.push(child);
      return child;
    };
    const started = Date.now();
    await expect(startPreview(PORT.dies, 20000, { spawnServer: dying })).rejects.toThrow(
      /뜨자마자 죽었다[\s\S]*이미 있다/,
    );
    // 20초를 기다리지 않는다. 기다리면 그 바퀴는 까닭 없이 느려진 것처럼 보인다.
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it('대답한 것이 내 서버가 아니면 멈춘다 — 조용히 남의 서버를 재지 않는다', async () => {
    // 내 자식은 살아 있는데 포트를 쥔 것은 딴 놈인 판. 세션 118 이전의 도구는
    // 이 판에서 아무 말 없이 그 딴 놈 위에서 화면을 찍었다.
    const sleeper = (port) => {
      fakeServer(port); // 포트를 쥐는 것은 이쪽
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      });
      child.killsAsGroup = true;
      spawned.push(child);
      return child;
    };

    await expect(startPreview(PORT.notMine, 10000, { spawnServer: sleeper })).rejects.toThrow(
      /내가 띄운 서버가 아니다/,
    );
  });
});
