import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  { ignores: ['dist/', 'node_modules/', '.next/', 'coverage/', 'standalone/'] },
  js.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    settings: { react: { version: 'detect' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'react/prop-types': 'off',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'complexity': ['error', { max: 15 }],
      'max-depth': ['error', { max: 4 }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': 'error',
      'sonarjs/no-nested-functions': 'error',
      'sonarjs/no-nested-conditional': 'error',
      'security/detect-object-injection': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.*', '**/__tests__/**'],
    rules: {
      'max-lines-per-function': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
];
