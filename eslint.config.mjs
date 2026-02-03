// backend/eslint.config.mjs
// @ts-check

// ESLint Core ----------------------------------------------------------
import eslint from '@eslint/js';

// Prettier Integration -------------------------------------------------
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

// Globals --------------------------------------------------------------
import globals from 'globals';

// TypeScript ESLint ----------------------------------------------------
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ====================================================================
  // # FILES TO IGNORE
  // ====================================================================
  {
    ignores: [
      'eslint.config.mjs',
      '.eslintrc.js',
      'jest.config.ts',
    ],
  },

  // ====================================================================
  // # BASE CONFIGS
  // ====================================================================
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,

  // ====================================================================
  // # LANGUAGE OPTIONS
  // ====================================================================
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',

      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ====================================================================
  // # CUSTOM RULES
  // ====================================================================
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Prettier formatting enforcement
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },

  // ====================================================================
  // # TEST OVERRIDES (relax unsafe rules for e2e/specs)
  // ====================================================================
  {
    files: ['test/**/*.ts', '**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
