import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { defineConfig, includeIgnoreFile } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  includeIgnoreFile(fileURLToPath(new URL('../.gitignore', import.meta.url))),
  { ignores: ['src/types/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    ignores: ['tests/e2e/**', 'tests/electron/**'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: [
      'electron/**/*.ts',
      'tests/e2e/**/*.ts',
      'tests/electron/**/*.ts',
      '*.config.ts',
      '*.mjs',
      'scripts/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  { files: ['*.mjs', 'scripts/**/*.mjs'], ...tseslint.configs.disableTypeChecked },
)
