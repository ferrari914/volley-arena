import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'logs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // node에서 도는 파일들(도구와 그 검사). process·__dirname 같은 것을 쓴다.
    files: ['tools/**/*.mjs', 'tests/**/*.mjs'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // 타입 검사는 tsc가 한다. no-undef는 TS에서 오탐만 낸다.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
