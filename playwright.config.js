module.exports = {
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  // CI 加固：禁止漏下的 test.only、CI 上重试一次、用 github reporter。
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
};
