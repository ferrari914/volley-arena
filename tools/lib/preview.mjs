/**
 * 빌드 결과를 띄우는 미리보기 서버. 브라우저를 쓰는 도구 넷이 함께 쓴다
 * (`tools/shot.mjs` 화면 QA · `tools/enemy-shot.mjs` 적 화면 ·
 * `tools/card-shot.mjs` 카드 화면 · `tools/latency.mjs` 입력 지연).
 *
 * 도구마다 포트를 달리 주면 둘을 동시에 돌려도 부딪히지 않는다.
 *
 * ---
 *
 * **[세션 118] 이 파일이 서버를 샜고, 새는 것보다 나쁜 일이 그 뒤에 있었다.**
 *
 * 세션 117이 곁눈으로 본 것: `vite preview` 서버 둘이 아직 살아 있었다 —
 * 포트 4183이 **11일 12시간**, 포트 4191이 **8일 6시간**. 둘 다 `PPID=1`,
 * 곧 **띄운 도구가 죽을 때 함께 죽지 않고 고아로 남은 것**이다(바퀴가 턴을 다 써서
 * 세션이 통째로 끊기면 `finally`는 돌지 않는다 — `SIGKILL`에는 뒷정리가 없다).
 *
 * **새는 포트는 고장이 아니다. 고장은 그다음 바퀴에 난다.**
 * 포트를 쥔 채 남아 있으므로 다음 바퀴의 `vite preview`는 `--strictPort`에 막혀
 * **즉시 죽는데**(`Error: Port 4183 is already in use` · 이번 바퀴가 직접 재현했다),
 * 아래 `waitForServer`는 **"누군가 대답하는가"만 묻는다.** 11일 전 서버가 대답하므로
 * 도구는 아무 말 없이 **제 것이 아닌 서버 위에서** 화면을 찍고 지연을 잰다.
 * 그리고 `stop()`은 이미 죽은 제 자식을 한 번 더 죽인다 — 고아는 그대로 남는다.
 *
 * `tools/lib/lock.mjs`의 머리말이 이 함정을 이미 적어 두었지만(세션 33~34),
 * 그 자물쇠는 **살아 있는 도구 둘**을 막는 자다. 여기 남은 고아는 주인이 죽어 있어서
 * 자물쇠가 알아서 걷어내고 자리를 넘겨준다 — **자물쇠를 통과한 바퀴가 남의 서버를 쓴다.**
 *
 * **그래서 세 가지를 바꿨다.**
 * ① **띄우기 전에 그 포트를 쥔 고아를 걷어낸다**(`reapPort`). 남의 프로그램이 쥐고 있으면
 *    죽이지 않고 **누구인지 적어서 던진다** — 이 저장소가 안 띄운 것을 죽일 권리는 없다.
 * ② **`npx`를 거치지 않고 vite를 직접 띄운다.** 샌 것이 둘씩 짝지어 있던 까닭이 이것이다
 *    (`npm exec` 껍데기 + 진짜 서버). 껍데기가 없으면 `stop()`이 진짜 서버에 바로 닿는다.
 *    게다가 `detached: true`로 제 프로세스 그룹을 주므로 `stop()`이 **그룹째** 내린다.
 * ③ **뜬 서버가 내가 띄운 그 서버인지 확인한다.** 포트를 실제로 쥔 pid가 내 자식이 아니면
 *    던진다. 조용히 남의 서버를 재는 것이 이 파일이 저지른 일이고, 그 자리를 여기서 막는다.
 * 그리고 `SIGKILL`이 아닌 모든 끝(정상 종료·예외·Ctrl-C)에서는 나갈 때 그룹을 내린다.
 * `SIGKILL`로 끊긴 바퀴가 남긴 고아는 ①이 다음 바퀴에 걷어낸다 — **뒷정리를 죽는 쪽이
 * 아니라 오는 쪽에 맡기는 것**이 이 파일의 유일한 확실한 수다.
 *
 * 무는지는 `tests/preview.test.mjs`가 매 바퀴 다시 잰다(가짜 서버로 판을 만든다 —
 * 검사는 `npm run build`도 vite도 필요로 하지 않는다).
 */
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 직접 띄우는 vite. `npx`(=`npm exec`) 껍데기를 한 겹 걷어낸 자리다. */
const VITE_BIN = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));

/** 고아를 걷어낼 때 `SIGTERM`이 듣기를 기다리는 시간(ms). 넘기면 `SIGKILL`로 간다. */
const TERM_GRACE_MS = 3000;

/** 포트가 비기를 기다리는 시간(ms). 프로세스가 죽어도 소켓이 바로 놓이지는 않는다. */
const PORT_FREE_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 그 포트를 **듣고 있는** pid들. 아무도 없으면 빈 배열이다.
 * (`lsof`는 맞는 것이 없으면 종료 코드 1로 끝난다 — 그것은 고장이 아니다.)
 */
export function listeningPids(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split('\n').map((line) => Number(line.trim())))].filter(
      (pid) => Number.isInteger(pid) && pid > 0,
    );
  } catch {
    return [];
  }
}

/** 그 pid의 명령줄. 이미 죽었으면 빈 문자열. */
export function processCommand(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * 이 명령줄이 **이 저장소의 도구가 그 포트에 띄운 미리보기 서버**인가.
 *
 * 걷어내도 되는 것과 건드리면 안 되는 것을 가르는 자리이므로 좁게 본다:
 * `vite preview`여야 하고, `--port`에 적힌 수가 **그 포트와 정확히 같아야** 한다
 * (`--port 41830`이 `4183`으로 읽히면 남의 서버를 죽인다).
 *
 * 껍데기를 걷어낸 지금도 `npx`로 띄운 옛 모양을 함께 알아본다 —
 * 지금 살아 있는 고아들이 그 모양이고, 그것을 못 알아보면 걷어낼 수가 없다.
 */
export function isOurPreview(command, port) {
  if (!/(^|[\s/])(?:vite|vite\.js)\s+preview(\s|$)/.test(command)) return false;
  return new RegExp(`--port(?:=|\\s+)${port}(?!\\d)`).test(command);
}

/** 그 pid가 아직 살아 있는가. EPERM은 "남의 것이지만 살아 있다"는 뜻이다. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** 포트가 빌 때까지 기다린다. 끝내 안 비면 false. */
async function waitForPortFree(port, timeoutMs = PORT_FREE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listeningPids(port).length === 0) return true;
    await sleep(100);
  }
  return listeningPids(port).length === 0;
}

/**
 * 그 포트를 쥐고 있는 **우리 고아**를 걷어낸다. 걷어낸 pid들을 돌려준다.
 *
 * 남의 프로그램이 쥐고 있으면 **죽이지 않고 던진다.** 여기서 조용히 죽이면
 * 이 저장소가 제 포트라고 믿는 수 넷(4183·4184·4189·4191) 때문에 남의 일이 끊긴다.
 *
 * @param {number} port
 * @param {{ isMine?: (command: string, port: number) => boolean }} [options]
 */
export async function reapPort(port, options = {}) {
  const isMine = options.isMine ?? isOurPreview;
  const holders = listeningPids(port).filter((pid) => pid !== process.pid);
  if (holders.length === 0) return [];

  const foreign = holders.filter((pid) => !isMine(processCommand(pid), port));
  if (foreign.length > 0) {
    const who = foreign.map((pid) => `  pid ${pid}: ${processCommand(pid) || '(명령줄을 읽을 수 없다)'}`);
    throw new Error(
      `포트 ${port}를 이 저장소가 안 띄운 프로그램이 쥐고 있다 — 죽이지 않고 멈춘다.\n` +
        `${who.join('\n')}\n` +
        '그 프로그램을 내리거나, 도구의 포트를 다른 수로 바꿔라.',
    );
  }

  for (const pid of holders) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 이미 죽었다. 아래에서 포트가 비는지로 확인한다.
    }
  }
  const deadline = Date.now() + TERM_GRACE_MS;
  while (Date.now() < deadline && holders.some(alive)) await sleep(100);
  for (const pid of holders.filter(alive)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 지금 죽었다.
    }
  }
  if (!(await waitForPortFree(port))) {
    throw new Error(`포트 ${port}를 쥔 서버를 걷어냈는데도 포트가 비지 않는다(pid ${holders.join(', ')})`);
  }
  console.log(
    `앞선 바퀴가 남긴 미리보기 서버를 걷어냈다: 포트 ${port} · pid ${holders.join(', ')}`,
  );
  return holders;
}

/** 서버가 응답할 때까지 기다린다. 도중에 내 서버가 죽으면 기다리지 않고 던진다. */
async function waitForServer(url, timeoutMs, state) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.exit !== null) {
      throw new Error(
        `미리보기 서버가 뜨자마자 죽었다(종료 코드 ${state.exit}).\n` +
          `${state.stderr.trim() || '(아무 말도 남기지 않았다)'}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 아직 안 떴다. 다시 시도한다.
    }
    await sleep(250);
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 뜨지 않았다: ${url}`);
}

/**
 * 프로세스 그룹째 신호를 보낸다. 그룹이 없으면(이미 죽었으면) 자식 하나에만 보낸다.
 *
 * **`detached`로 띄운 자식에만 그룹으로 보낸다**(`killsAsGroup`). 붙어 있는 자식은
 * 우리와 같은 그룹에 있어서, `-pid`가 엉뚱한 남의 그룹을 가리킬 수 있다.
 */
function signalGroup(child, signal) {
  if (child.killsAsGroup) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // 그룹이 이미 사라졌다.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // 이미 죽었다.
  }
}

/**
 * `vite preview`를 띄우고 응답할 때까지 기다린다.
 *
 * 돌려주는 `stop()`을 **반드시 `await`와 함께 `finally`에서 부를 것.**
 * 그래도 못 부르는 끝(세션이 `SIGKILL`로 끊기는 경우)이 있으므로, 다음 바퀴가
 * 들어올 때 이 함수가 그 자리를 스스로 치운다(위 머리말 ①).
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @param {{ spawnServer?: (port: number) => import('node:child_process').ChildProcess,
 *           isMine?: (command: string, port: number) => boolean }} [options]
 *        검사가 vite 없이 판을 만들기 위한 자리다. 도구는 넘기지 않는다.
 */
export async function startPreview(port, timeoutMs = 20000, options = {}) {
  await reapPort(port, options);

  const url = `http://127.0.0.1:${port}/`;
  const spawnServer =
    options.spawnServer ??
    ((p) =>
      spawn(
        process.execPath,
        [VITE_BIN, 'preview', '--port', String(p), '--strictPort', '--host', '127.0.0.1'],
        { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
      ));
  const server = spawnServer(port);
  if (!options.spawnServer) server.killsAsGroup = true;

  // 죽은 까닭을 손에 쥐고 있어야 "안 떴다"가 아니라 "왜 안 떴다"를 적을 수 있다.
  const state = { exit: null, stderr: '' };
  server.stderr?.on('data', (chunk) => {
    state.stderr = (state.stderr + chunk).slice(-2000);
  });
  server.on('exit', (code, signal) => {
    state.exit = code ?? signal ?? 0;
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    process.off('exit', onExit);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (state.exit === null) {
      signalGroup(server, 'SIGTERM');
      const deadline = Date.now() + TERM_GRACE_MS;
      while (Date.now() < deadline && state.exit === null) await sleep(100);
      if (state.exit === null) signalGroup(server, 'SIGKILL');
    }
    await waitForPortFree(port);
  };
  // 나가는 길에 그룹을 내린다. `exit`은 동기라 여기서 기다릴 수 없고, 기다릴 필요도 없다.
  function onExit() {
    signalGroup(server, 'SIGKILL');
  }
  function onSignal() {
    signalGroup(server, 'SIGKILL');
    process.exit(130);
  }
  process.on('exit', onExit);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await waitForServer(url, timeoutMs, state);
    // **대답한 것이 내 서버인가.** 이 확인이 없으면 남의 서버 위에서 QA가 돈다.
    const holders = listeningPids(port);
    if (holders.length > 0 && !holders.includes(server.pid)) {
      throw new Error(
        `포트 ${port}에서 대답한 것이 내가 띄운 서버가 아니다(대답한 pid ${holders.join(', ')} · 내 pid ${server.pid}).\n` +
          '남의 서버 위에서 찍은 화면과 잰 값은 이 저장소의 값이 아니므로 여기서 멈춘다.',
      );
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, pid: server.pid, stop };
}
