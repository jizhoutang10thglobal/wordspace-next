import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// 页面与正本（../CHANGELOG.md）绑定断言：不是「页面上有点内容」这种弱门——
// 从正本解析出最新版本号/首条条目，断言页面真渲染了它们（parser 坏/数据源断 → 红）。
const changelogMd = readFileSync(path.join(__dirname, '..', '..', '..', 'CHANGELOG.md'), 'utf8');
const versions = [...changelogMd.matchAll(/^## (v\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})/gm)];
const latest = versions[0];

test.describe('/changelog', () => {
  test('渲染正本：最新版本号在最上、带「最新」徽标、日期正确', async ({ page }) => {
    const response = await page.goto('/changelog');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: '更新日志' })).toBeVisible();

    const entries = page.locator('.cl-entry');
    expect(await entries.count()).toBe(versions.length); // 每个 ## vX.Y.Z 都渲染成一个条目
    const first = entries.first();
    await expect(first.locator('.cl-entry__version')).toHaveText(latest[1]);
    await expect(first.locator('.cl-entry__date')).toHaveText(latest[2]);
    await expect(first.locator('.cl-badge--latest')).toBeVisible();
  });

  test('条目内容真来自正本：正本首个列表项的文字出现在页面里', async ({ page }) => {
    // 取正本第一条 "- " 列表行（剥掉 markdown 痕迹后应原样出现在页面）
    const firstBullet = changelogMd
      .split('\n')
      .find((l) => l.startsWith('- '))!
      .slice(2)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1');
    await page.goto('/changelog');
    await expect(page.locator('.cl-items li').first()).toContainText(firstBullet.slice(0, 20));
  });

  test('首页页头/页脚有「更新日志」入口，点击可达', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-changelog').click();
    await expect(page).toHaveURL(/\/changelog$/);
    await expect(page.getByRole('heading', { level: 1, name: '更新日志' })).toBeVisible();
  });

  test('sitemap 含 /changelog', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('https://wordspace.ai/changelog');
  });
});
