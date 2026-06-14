import { expect, test } from '@playwright/test';

const MIRROR = 'github.com/jizhoutang10thglobal/wordspace-releases';

test.describe('wordspace.ai landing', () => {
  test('home page renders hero + double download CTA', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole('heading', { level: 1, name: /bring your own ai/i }),
    ).toBeVisible();

    await expect(page.getByTestId('cta-mac')).toBeVisible();
    await expect(page.getByTestId('cta-win')).toBeVisible();

    await expect(
      page.getByRole('heading', { name: /how it works/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /frequently asked/i }),
    ).toBeVisible();
  });

  test('/downloads/mac returns 302 to the public mirror .dmg', async ({ request }) => {
    const res = await request.get('/downloads/mac', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(MIRROR);
    expect(location).toContain('wordspace-mac-arm64.dmg');
  });

  test('/downloads/win returns 302 to the public mirror .exe', async ({ request }) => {
    const res = await request.get('/downloads/win', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(MIRROR);
    expect(location).toContain('wordspace-windows-setup.exe');
  });

  test('/downloads/linux returns 200 with coming soon copy', async ({ page }) => {
    const response = await page.goto('/downloads/linux');
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: /coming soon/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();
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
