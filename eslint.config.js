import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**']),
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // NestJS modules are classes that only carry decorators.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
    },
  },
  {
    // Module boundaries (architecture.md §2): no circular imports anywhere.
    files: ['**/*.ts'],
    plugins: { 'import-x': importX },
    settings: {
      // Without these, import-x cannot parse the .ts files it follows and misses cycles.
      ...importX.flatConfigs.typescript.settings,
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
    },
  },
  {
    // Business modules reach data only through TenantDatabase.withTenant (ADR-0003).
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'Use TenantDatabase.withTenant instead of a raw connection.' },
            {
              name: 'drizzle-orm/node-postgres',
              message: 'Use TenantDatabase.withTenant instead of an unscoped database handle.',
            },
            { name: '@ultimate-erp/db/admin', message: 'Admin tools are for CLI and tests only.' },
            { name: '@ultimate-erp/db/testing', message: 'Test helpers are for tests only.' },
          ],
          patterns: [
            {
              group: ['**/platform/database/database.tokens.js'],
              message: 'Raw database handles are platform-only; use TenantDatabase.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
