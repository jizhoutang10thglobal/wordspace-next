import { defineConfig } from '@playwright/test';

// 单测（纯函数，零浏览器）走独立 config：e2e 那份的 webServer 跑的是 `next start`，
// 意味着「想跑一条 parser 单测得先 next build」——那太重了。同一个 playwright runner，
// 不引新依赖、不加新的 TS 转译链。跑：npm run test:unit
export default defineConfig({
  testDir: './tests/unit',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
});
