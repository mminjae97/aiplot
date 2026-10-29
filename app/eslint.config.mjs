import { fileURLToPath } from 'node:url'
import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  includeIgnoreFile(fileURLToPath(new URL('../.gitignore', import.meta.url))),
  { ignores: ['src/types/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    ignores: ['tests/e2e/**'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['electron/**/*.ts', 'tests/e2e/**/*.ts', '*.config.ts', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  { files: ['*.mjs'], ...tseslint.configs.disableTypeChecked },
)
