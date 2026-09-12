/**
 * **브라우저 도구는 한 번에 하나만 돈다.**
 *
 * `tools/`의 세 도구(`shot.mjs` 화면 QA · `enemy-shot.mjs` 적 화면 · `latency.mjs` 입력 지연)는
 * 전부 헤드리스 크로미움을 띄우고 **소프트웨어 렌더러(swiftshader)로** 그린다. 그림을 CPU가
 * 그리므로 둘이 함께 돌면 서로의 프레임을 빼앗는다. 문제는 느려지는 것 자체가 아니라,
 * **느려진 값이 게임의 값인 것처럼 적힌다**는 데 있다.
 *
 * 실제로 그렇게 됐다(세션 31~34). `npm run qa`가 "서 있는데 안 쓰러진다"로 네 바퀴를 울었고,
 * 세 바퀴가 게임을 의심했다 재는 자를 세 번 고쳤다. 세션 34가 프로세스 목록을 보고서야
 * **세션 33이 남긴 여덟 바퀴짜리 QA 러너가 아직 돌고 있다는 것**을 알았다 — 그 위에서
 * 세션 34가 자기 네 바퀴를 얹어 돌리고 있었다. 두 벌의 크로미움이 한 기계에서 겨루는 동안
 * 나온 `0.08배` · `19~22fps`가 STATUS에 게임 이야기로 적혀 있었다.
 *
 * 게다가 **같은 도구를 둘 돌리면 미리보기 서버까지 겹친다.** 포트는 도구마다 다르지만
 * (`preview.mjs`) 같은 도구끼리는 같은 포트다. 나중에 뜬 쪽은 `--strictPort`에 막혀
 * 제 서버를 못 띄우는데, 먼저 뜬 쪽 서버가 대답하므로 **아무 말 없이 남의 서버를 쓴다.**
 * 그러다 먼저 뜬 쪽이 끝나며 서버를 내리면 남은 쪽은 원점을 잃는다.
 *
 * 그래서 자물쇠를 하나 둔다. 이미 돌고 있으면 **조용히 느려지는 대신 시끄럽게 멈춘다** —
 * 못 잰 것은 다음에 다시 재면 되지만, 잘못 잰 값은 문서에 남아 여러 바퀴를 끌고 간다.
 *
 * 주인이 죽은 자물쇠(세션이 끊기며 남긴 것)는 알아서 걷어내고 그 자리를 넘겨받는다.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

/** 자물쇠 자리. `logs/`는 git이 무시하므로 저장소에 남지 않는다. */
const LOCK_PATH = 'logs/browser-tool.lock';

/** 자물쇠에 막혀 끝날 때의 종료 코드. 검사가 "실패"한 것과 "돌지 못한" 것은 다른 일이다. */
export const LOCK_BUSY_EXIT = 3;

/** 그 pid가 아직 살아 있는가. EPERM은 "남의 프로세스지만 살아 있다"는 뜻이다. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** 자물쇠에 적힌 주인. 읽을 수 없으면 null(주인 없는 것으로 본다). */
function readHolder() {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function busyMessage(holder) {
  const minutes = Math.max(0, Math.round((Date.now() - (holder.startedAt ?? Date.now())) / 60000));
  return (
    `브라우저 도구가 이미 돌고 있다: ${holder.tool ?? '알 수 없는 도구'} ` +
    `(pid ${holder.pid} · ${minutes}분째)\n` +
    '  둘을 한 기계에서 함께 돌리면 소프트웨어 렌더러와 CPU를 나눠 쓴다 — 그때 나오는\n' +
    '  fps·프레임 수·"게임 시계가 안 간다"는 게임이 아니라 그 경쟁을 잰 값이다.\n' +
    `  끝나기를 기다리거나, 먼저 멈춰라:  kill ${holder.pid}`
  );
}

/** 우리가 잡은 자물쇠만 푼다. 남의 것을 지우면 그쪽이 자물쇠 없이 돌게 된다. */
function release() {
  const holder = readHolder();
  if (holder?.pid !== process.pid) return;
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // 이미 없어졌다. 풀린 것과 같다.
  }
}

let registered = false;
function registerRelease() {
  if (registered) return;
  registered = true;
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }
}

/**
 * 자물쇠를 잡는다. 이미 살아 있는 주인이 있으면 던진다.
 * 잡으면 프로세스가 끝날 때(정상 종료 · Ctrl-C · SIGTERM) 알아서 풀린다.
 *
 * SIGKILL로 죽으면 풀 기회가 없다 — 그 자리는 다음 도구가 주인이 없는 것을 보고 넘겨받는다.
 */
export function acquireBrowserLock(tool) {
  mkdirSync('logs', { recursive: true });
  // 두 번만 시도한다: 한 번은 그냥, 한 번은 주인 없는 자물쇠를 걷어낸 뒤.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try {
      fd = openSync(LOCK_PATH, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = readHolder();
      if (holder && alive(holder.pid)) throw new Error(busyMessage(holder), { cause: error });
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        // 그새 다른 쪽이 걷어냈다. 다음 바퀴에서 다시 잡아 본다.
      }
      continue;
    }
    try {
      writeSync(fd, JSON.stringify({ tool, pid: process.pid, startedAt: Date.now() }));
    } finally {
      closeSync(fd);
    }
    registerRelease();
    return release;
  }
  throw new Error(`자물쇠(${LOCK_PATH})를 잡지 못했다 — 다른 쪽과 계속 부딪힌다`);
}

/** 테스트가 쓰는 자리. 도구는 이 값을 몰라도 된다. */
export const BROWSER_LOCK_PATH = LOCK_PATH;
