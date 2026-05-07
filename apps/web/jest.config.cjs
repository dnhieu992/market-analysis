const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './'
});

const customJestConfig = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  moduleNameMapper: {
    '^@web/pages/(.*)$': '<rootDir>/src/_pages/$1',
    '^@web/(.*)$': '<rootDir>/src/$1'
  },
  maxWorkers: 1
};

module.exports = createJestConfig(customJestConfig);
