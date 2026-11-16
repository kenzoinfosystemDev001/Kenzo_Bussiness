// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/next-env.d.ts', 'apps/api/prisma/migrations/**', 'storage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
          message: 'Use tagged-template $queryRaw/$executeRaw so parameters are bound (SQL injection safety).',
        },
      ],
    },
  },
  {
    // NestJS relies on runtime class references for DI; type-only imports would break injection.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    // Scripts and tests may print and may use raw admin SQL for setup/teardown.
    files: ['apps/api/scripts/**/*.ts', 'apps/api/prisma/**/*.ts', 'apps/api/test/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off', '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/api/jest.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Never render untrusted HTML.
      'no-restricted-properties': ['error', { property: 'dangerouslySetInnerHTML', message: 'Rendering raw HTML is forbidden (XSS).' }],
    },
  },
  prettier,
);
