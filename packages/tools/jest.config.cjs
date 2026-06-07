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
  },
  transformIgnorePatterns: [
    // Игнорируем все node_modules, НО не игнорируем наши пакеты
    'node_modules/(?!@robocode-packages/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  // Если нужно, чтобы Jest обрабатывал .js файлы в dist как ESM
  moduleFileExtensions: ['ts', 'js', 'json'],
};
