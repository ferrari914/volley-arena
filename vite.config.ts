import { defineConfig } from 'vite';

// base: './' — 어느 정적 호스팅 경로에 올려도 그대로 열리게 한다.
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022' },
});
