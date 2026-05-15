/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  testTimeout: 60_000,
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};
