import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'dist-e2e', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Status chips wrap their text in a few spans.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 4 }],
      // Task rows and access tokens must never end up in logs.
      'no-console': 'error',
      // Task data lives in memory only: no browser storage of any kind.
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Do not persist task data or tokens.' },
        { name: 'sessionStorage', message: 'Do not persist task data or tokens.' },
        { name: 'indexedDB', message: 'Do not persist task data or tokens.' },
        { name: 'caches', message: 'Do not cache task data.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: 'Do not persist task data or tokens.' },
        { object: 'window', property: 'sessionStorage', message: 'Do not persist task data or tokens.' },
        { object: 'window', property: 'indexedDB', message: 'Do not persist task data or tokens.' },
        { object: 'navigator', property: 'serviceWorker', message: 'No service workers: they would cache data.' },
      ],
      // Notes are rendered as text, never as HTML.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render sheet content as text, never HTML.',
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: 'Render sheet content as text, never HTML.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'e2e/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['vite.config.ts', 'playwright.config.ts', 'security-headers.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Browser tests inspect storage to prove the app leaves it empty.
    files: ['e2e/**'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]);
