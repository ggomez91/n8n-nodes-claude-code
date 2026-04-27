/** @type {import('jest').Config} */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
};

module.exports = {
  testTimeout: 15000,
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
    },
  ],
};
