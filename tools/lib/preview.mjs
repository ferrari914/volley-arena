/**
 * 빌드 결과를 띄우는 미리보기 서버. 브라우저를 쓰는 도구들이 함께 쓴다
 * (`tools/shot.mjs` 화면 QA, `tools/latency.mjs` 입력 지연 측정).
 *
 * 도구마다 포트를 달리 주면 둘을 동시에 돌려도 부딪히지 않는다.
 */
import { spawn } from 'node:child_process';

/** 서버가 응답할 때까지 기다린다. 뜨지 않으면 던진다 — 조용히 빈 화면을 재지 않게. */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 아직 안 떴다. 다시 시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 뜨지 않았다: ${url}`);
}

/**
 * `vite preview`를 띄우고 응답할 때까지 기다린다.
 * 돌려주는 `stop()`을 반드시 finally에서 부를 것 — 안 그러면 서버가 남는다.
 */
export async function startPreview(port, timeoutMs = 20000) {
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(
    'npx',
    ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { stdio: 'ignore' },
  );
  try {
    await waitForServer(url, timeoutMs);
  } catch (error) {
    server.kill();
    throw error;
  }
  return { url, stop: () => server.kill() };
}
