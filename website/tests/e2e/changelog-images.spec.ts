import { expect, test } from '@playwright/test';
import { FIXTURE_CHANGELOG_MD } from '../../app/changelog/fixture/fixture-md';

// 配图的渲染门。喂固定夹具（/changelog/fixture 走的是跟 /changelog 一模一样的 parser +
// 视图组件），断言的是「图真的被浏览器加载出来了」而不是「DOM 里有个 img 标签」——
// 后者在路径映射坏掉、线上 404 的情况下照样绿（这仓的哑门样本库里同款教训一堆）。
const FIXTURE_URL = '/changelog/fixture';
const imageLines = FIXTURE_CHANGELOG_MD.split('\n').filter((l) => l.startsWith('!['));

test.describe('/changelog 配图', () => {
  test('夹具页把每个图片行渲染成 figure，图真加载出来、图注就是 alt', async ({ page }) => {
    const response = await page.goto(FIXTURE_URL);
    expect(response?.status()).toBe(200);

    const figures = page.locator('.cl-figure');
    expect(await figures.count()).toBe(imageLines.length); // 夹具里几行图，页面上就几个 figure
    expect(imageLines.length).toBeGreaterThan(0); // 夹具被清空 = 门变哑，这里先拦一道

    for (let i = 0; i < imageLines.length; i++) {
      const fig = figures.nth(i);
      const img = fig.locator('img');
      const alt = await img.getAttribute('alt');
      expect(alt?.trim()).toBeTruthy();

      // 图注 = alt（只有一份文字，不会出现「alt 和图注各写一套」的漂移）
      await expect(fig.locator('figcaption')).toHaveText(alt!);

      // 真加载成功：naturalWidth > 0。路径映射被删/图丢了 → 404 → 0 → 红。
      const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);

      await expect(img).toHaveAttribute('loading', 'lazy');
      await expect(img).toHaveAttribute('decoding', 'async');
    }
  });

  test('图不撑破版心，也不比正文列宽', async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const main = (await page.locator('.cl-main').boundingBox())!;
    const li = (await page.locator('.cl-items li').first().boundingBox())!;
    const figures = page.locator('.cl-figure img');
    const count = await figures.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = (await figures.nth(i).boundingBox())!;
      // 夹具图是 1600px 宽，比任何一列都宽——没有宽度约束时这两条必红
      expect(box.width).toBeLessThanOrEqual(li.width + 1);
      expect(box.x).toBeGreaterThanOrEqual(main.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 1);
    }
  });
});
