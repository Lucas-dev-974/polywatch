// Flat ESLint config (ESLint v9+) preserving rules from legacy .eslintrc.cjs.
import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  eslint.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // Preserve legacy leniency from the original .eslintrc.cjs.
      'prefer-const': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
];
