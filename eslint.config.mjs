import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixupConfigRules, fixupPluginRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import _import from 'eslint-plugin-import';
import globals from 'globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  // ESLint core + import plugin
  {
    extends: fixupConfigRules(compat.extends('eslint:recommended', 'plugin:import/recommended')),
    plugins: {
      import: fixupPluginRules(_import),
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // let Prettier handle style rules, don't duplicate
      // quotes and semi removed

      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // Prettier turns off stylistic ESLint rules that conflict
  prettier,
]);
