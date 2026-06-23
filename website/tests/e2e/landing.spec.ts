import { expect, test } from '@playwright/test';

const RELEASES = 'github.com/jizhoutang10thglobal/wordspace-next';

test.describe('wordspace.ai landing', () => {
  test('home page renders hero + mac/intel/win download CTAs', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole('heading', { level: 1, name: /编辑 HTML/ }),
    ).toBeVisible();

    await expect(page.getByTestId('cta-mac')).toBeVisible();
    await expect(page.getByTestId('cta-mac-intel')).toBeVisible();
    await expect(page.getByTestId('cta-win')).toBeVisible();
  });

  test('/downloads/mac returns 302 to the latest signed .dmg', async ({ request }) => {
    const res = await request.get('/downloads/mac', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(RELEASES);
    expect(location).toContain('wordspace-next-mac-arm64.dmg');
  });

  test('/downloads/mac-intel returns 302 to the latest signed x64 .dmg', async ({ request }) => {
    const res = await request.get('/downloads/mac-intel', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(RELEASES);
    expect(location).toContain('wordspace-next-mac-x64.dmg');
  });

  test('/downloads/win returns 302 to the latest signed .exe', async ({ request }) => {
    const res = await request.get('/downloads/win', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(RELEASES);
    expect(location).toContain('wordspace-next-win-x64.exe');
  });

  test('mobile viewport keeps hero CTA clickable', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const page = await context.newPage();
    await page.goto('/');

    const mac = page.getByTestId('cta-mac');
    await expect(mac).toBeVisible();
    const box = await mac.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(120);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByTestId('cta-win')).toBeVisible();

    await context.close();
  });
});
