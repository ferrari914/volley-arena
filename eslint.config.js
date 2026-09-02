import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'logs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tools/**/*.mjs'],
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
