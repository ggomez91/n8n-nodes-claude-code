module.exports = {
  root: true,
  env: { browser: false, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist/**', 'node_modules/**', 'test/fixtures/**'],
  overrides: [
    {
      files: ['nodes/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/nodes'],
      rules: {
        'n8n-nodes-base/node-execute-block-missing-continue-on-fail': 'off',
      },
    },
    {
      files: ['test/**/*.ts'],
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
