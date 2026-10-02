import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  { files: ['**/*.ts'], languageOptions: { parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } }, plugins: { '@typescript-eslint': tseslint }, rules: { 'no-console': 'warn', '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/consistent-type-imports': 'error' } }
];
