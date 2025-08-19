/* Shared ESLint configuration for the monorepo */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2023: true,
  },
  ignorePatterns: ['dist', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: [
      // Uncomment if you want project-aware rules (needs tsconfig references)
      // "./backend/tsconfig.json",
      // "./frontend/tsconfig.json"
    ],
    tsconfigRootDir: __dirname,
    ecmaFeatures: { jsx: true },
    sourceType: 'module',
  },
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      typescript: {
        project: ['./backend/tsconfig.json', './frontend/tsconfig.json'],
      },
    },
  },
  plugins: ['@typescript-eslint', 'import', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    // General
    'no-console': 'off',
    'no-unused-vars': 'off', // handled by TS plugin
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'off',

    // Import ordering
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],

    // React tweaks
    'react/react-in-jsx-scope': 'off', // not needed in React 17+
    'react/prop-types': 'off', // using TS instead
  },
};
