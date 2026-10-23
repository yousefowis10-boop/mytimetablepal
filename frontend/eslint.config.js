import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
    },
  },
  {
    // Build tooling runs in Node, not the browser.
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Context modules export a provider plus its hook; fast refresh reloads them fully, which is fine.
    files: ['src/auth/**/*.jsx', 'src/components/**/*.jsx', 'src/pages/**/*.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
