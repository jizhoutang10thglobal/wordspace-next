import { defineConfig, devices } from '@playwright/test';

// 端口可用 WS_SITE_PORT 覆写：本仓常态多 session 并行，4000 常被别的 session 的
// dev server 占着——reuseExistingServer 会静默复用那个「旧站」，整套测试测错对象。
const PORT = Number(process.env.WS_SITE_PORT ?? 4000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
