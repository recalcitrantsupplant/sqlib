// The repository's one ESLint configuration, for every package's TypeScript.
//
// Syntactic rules only: `typescript-eslint`'s `recommended`, not its
// type-checked set, so a run needs no `tsc` program and takes seconds rather
// than minutes. `.vue` files are not linted here; stylelint covers their styles
// and `nuxi typecheck` their scripts.
//
// This lands on a tree that had never been linted, so it is a ratchet rather
// than a gate: scripts/lint-ratchet.mjs counts violations per package and rule
// and fails only when a count rises above scripts/lint-baseline.json. A rule
// whose count is zero is therefore enforced outright.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/*.d.ts',
      '**/*.generated.ts',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // `unused-imports` reports unused imports separately from unused
      // variables, so the import half can be autofixed (`--fix`) on its own.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
  {
    // Command-line entry points, build scripts, dev harnesses and tests talk to
    // a terminal on purpose.
    files: [
      '**/scripts/**',
      '**/dev/**',
      '**/poc/**',
      '**/test/**',
      '**/tests/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/cli.ts',
      '**/bin/**',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // The web app's own policy (src/lib/debug.ts): commentary goes through
    // `debug()`, which is compiled out of the production bundle, while a
    // warning or an error is for the user's console and stays.
    files: ['packages/web/src/**'],
    rules: { 'no-console': ['error', { allow: ['warn', 'error'] }] },
  },
);
