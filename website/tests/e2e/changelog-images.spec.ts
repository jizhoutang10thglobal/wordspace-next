import { expect, test } from '@playwright/test';
import { FIXTURE_CHANGELOG_MD } from '../../app/changelog/fixture/fixture-md';

// 配图的渲染门。喂固定夹具（/changelog/fixture 走的是跟 /changelog 一模一样的 parser +
// 视图组件），断言的是「图真的被浏览器加载出来了」而不是「DOM 里有个 img 标签」——
// 后者在路径映射坏掉、线上 404 的情况下照样绿（这仓的哑门样本库里同款教训一堆）。
const FIXTURE_URL = '/changelog/fixture';

// 期望值从夹具原文自己算，不复用 lib 里那套正则（复用就成了「被测对象自证」）。
// alt 取 `![` 到最后一个 `](` 之间，文件名取路径最后一段。
const expectedFigures = FIXTURE_CHANGELOG_MD.split('\n')
  .filter((l) => l.startsWith('!['))
  .map((l) => {
    const cut = l.lastIndexOf('](');
    return { alt: l.slice(2, cut), file: l.slice(cut + 2, -1).split('/').pop()! };
  });

test.describe('/changelog 配图', () => {
  test('夹具页把每个图片行渲染成 figure，图真加载出来、图注就是 alt', async ({ page }) => {
    const response = await page.goto(FIXTURE_URL);
    expect(response?.status()).toBe(200);

    const figures = page.locator('.cl-figure');
    expect(await figures.count()).toBe(expectedFigures.length); // 夹具里几行图，页面上就几个 figure
    expect(expectedFigures.length).toBeGreaterThan(1); // 夹具被清空/退化成一张 = 门变哑，先拦一道

    for (let i = 0; i < expectedFigures.length; i++) {
      const fig = figures.nth(i);
      const img = fig.locator('img');

      // 图注严格等于夹具里对应那一行的 alt：只数个数的话，图和图注错配、两张图互换都测不出来
      await expect(fig.locator('figcaption')).toHaveText(expectedFigures[i].alt);
      await expect(img).toHaveAttribute('alt', expectedFigures[i].alt);
      expect(await img.getAttribute('src')).toBe(`/changelog/${expectedFigures[i].file}`);

      // 真加载成功：naturalWidth > 0。路径映射被删/图丢了 → 404 → 0 → 红。
      const natural = await img.evaluate((el) => {
        const im = el as HTMLImageElement;
        return { w: im.naturalWidth, h: im.naturalHeight };
      });
      expect(natural.w).toBeGreaterThan(0);

      // 固有宽高必须写进属性且跟真图一致（浏览器靠它提前占位，见下面那条位移门）
      expect(await img.getAttribute('width')).toBe(String(natural.w));
      expect(await img.getAttribute('height')).toBe(String(natural.h));

      await expect(img).toHaveAttribute('loading', 'lazy');
      await expect(img).toHaveAttribute('decoding', 'async');
    }
  });

  test('图挂在正确的位置：版本级在导语下方，分组级在本组条目下方，别的组不沾', async ({ page }) => {
    await page.goto(FIXTURE_URL);

    // 只数 figure 个数的话，「把版本级的图也塞进每个分组」这种归属错乱照样全绿——
    // 所以这里钉的是 DOM 里的兄弟顺序，不是数量。
    const shape = await page.evaluate(() => {
      const tag = (el: Element) => el.tagName.toLowerCase() + (el.classList[0] ? `.${el.classList[0]}` : '');
      const entry = document.querySelector('.cl-entry')!;
      return {
        entry: [...entry.children].map(tag),
        groups: [...entry.querySelectorAll('.cl-group')].map((g) => [...g.children].map(tag)),
      };
    });

    expect(shape.entry).toEqual([
      'div.cl-entry__head',
      'p.cl-entry__lead',
      'figure.cl-figure', // 版本级配图：导语之后、第一个分组之前
      'div.cl-group',
      'div.cl-group',
    ]);
    expect(shape.groups[0]).toEqual(['span.cl-badge', 'ul.cl-items', 'figure.cl-figure']);
    expect(shape.groups[1]).toEqual(['span.cl-badge', 'ul.cl-items']); // 没配图的组不许冒出图来

    // 再钉一次「哪张图归哪儿」——两张图是不同文件，互换位置这条会红
    await expect(page.locator('.cl-entry > .cl-figure img')).toHaveAttribute(
      'src',
      `/changelog/${expectedFigures[0].file}`,
    );
    await expect(page.locator('.cl-group').first().locator('.cl-figure img')).toHaveAttribute(
      'src',
      `/changelog/${expectedFigures[1].file}`,
    );
  });

  test('图到货不把下方内容顶走（<img> 上的固有宽高被删就红）', async ({ page }) => {
    // 不写 width/height 时浏览器在图到货前按 0 高度排版，图一到就整体下推——
    // 实测首屏内一张图 = 下方内容位移 387px、CLS 0.166（Google「良好」阈值 0.1）。
    // 这里不测 CLS 指标本身，直接测那个失败形状：卡住图片响应，比较下方元素到货前后的位置。
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/changelog/fixture-render-check*.png', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    const below = page.locator('.cl-group').first();
    await below.waitFor();
    const firstImg = page.locator('.cl-figure img').first();
    expect(await firstImg.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(0); // 确认此刻真没到货
    const before = (await below.boundingBox())!;

    release();
    await expect
      .poll(() => firstImg.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const after = (await below.boundingBox())!;

    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
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
      // 夹具图是 1600px / 1200px 宽，比任何一列都宽——没有宽度约束时这两条必红
      expect(box.width).toBeLessThanOrEqual(li.width + 1);
      expect(box.x).toBeGreaterThanOrEqual(main.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 1);
    }
  });
});
