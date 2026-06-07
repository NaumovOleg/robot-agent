// jest.config.cjs
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^@robocode-packages/(.*)$': '<rootDir>/packages/$1/src',
    '^@langchain/langgraph$': '<rootDir>/packages/agent/node_modules/@langchain/langgraph/dist/index.js',
    '^@langchain/langgraph/(.*)$': '<rootDir>/packages/agent/node_modules/@langchain/langgraph/dist/$1',
    '^@langchain/anthropic$': '<rootDir>/packages/agent/node_modules/@langchain/anthropic/dist/index.cjs',
    '^@langchain/openai$': '<rootDir>/packages/agent/node_modules/@langchain/openai/dist/index.cjs',
  },
  transformIgnorePatterns: [
    // Игнорируем все node_modules, НО не игнорируем наши пакеты и ESM-зависимости
    'node_modules/(?!@robocode-packages/|@langchain/)',
  ],
  resolver: '<rootDir>/jest.resolver.cjs',
  extensionsToTreatAsEsm: ['.ts'],
  // Если нужно, чтобы Jest обрабатывал .js файлы в dist как ESM
  moduleFileExtensions: ['ts', 'js', 'json'],
};
