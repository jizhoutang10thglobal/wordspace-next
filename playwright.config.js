module.exports = {
  testDir: './e2e',
  timeout: 30000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {}
};
