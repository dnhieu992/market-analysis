module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.integration-spec.ts'],
  maxWorkers: 1,
  moduleNameMapper: {
    '^@app/db$': '<rootDir>/test/stubs/app-db.ts',
    '^@app/config$': '<rootDir>/../../packages/config/src',
    '^@app/core$': '<rootDir>/../../packages/core/src'
  }
};
