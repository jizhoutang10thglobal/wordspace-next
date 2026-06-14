import { expect, test } from '@playwright/test';

test.describe('SEO + GEO baseline', () => {
  test('/robots.txt returns 200 with default policy and sitemap reference', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/User-agent:\s*\*/);
    expect(body).toMatch(/Sitemap:\s*https:\/\/wordspace\.ai\/sitemap\.xml/);
    // AI crawlers should be explicitly allowed — this is a product
    // strategy decision (decision XIX), not a default, so lock it in.
    expect(body).toMatch(/User-agent:\s*GPTBot/);
    expect(body).toMatch(/User-agent:\s*ClaudeBot/);
    expect(body).toMatch(/User-agent:\s*PerplexityBot/);
    // 302 download short-links shouldn't burn crawler budget.
    expect(body).toMatch(/Disallow:\s*\/downloads\/mac/);
    expect(body).toMatch(/Disallow:\s*\/downloads\/win/);
  });

  test('/sitemap.xml returns 200 and lists both real pages', async ({
    request,
  }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('https://wordspace.ai/');
    expect(body).toContain('https://wordspace.ai/downloads/linux');
    // 302 short-links must NOT leak into the sitemap.
    expect(body).not.toContain('https://wordspace.ai/downloads/mac');
    expect(body).not.toContain('https://wordspace.ai/downloads/win');
  });

  test('/llms.txt returns 200 with llmstxt.org shape (H1 + blockquote)', async ({
    request,
  }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^#\s+wordspace/m);
    // llmstxt.org convention: the H1 is immediately followed by a
    // blockquote carrying the project's elevator pitch.
    expect(body).toMatch(/^>\s+wordspace is/m);
    expect(body).toContain('Copy Prompt');
    expect(body).toContain('/downloads/mac');
  });

  test('home renders og:title, twitter card, canonical, and inline JSON-LD', async ({
    page,
  }) => {
    await page.goto('/');

    // OG + Twitter core tags must be present for social previews.
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      /wordspace/i,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /wordspace\.ai\/og-image\.png$/,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );

    // Canonical must point at apex (decision XIX follow-up pending, but
    // today apex is the primary host). Next.js normalises the root URL
    // by stripping the trailing slash, so match both forms.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /^https:\/\/wordspace\.ai\/?$/,
    );

    // JSON-LD must include both SoftwareApplication and FAQPage so AI
    // engines and Google rich results can pick up the right entity.
    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    expect(jsonLd).toBeTruthy();
    const parsed = JSON.parse(jsonLd!) as {
      '@graph': Array<{ '@type': string }>;
    };
    const types = parsed['@graph']?.map((e) => e['@type']) ?? [];
    expect(types).toContain('SoftwareApplication');
    expect(types).toContain('FAQPage');
  });

  test('home and /downloads/linux have distinct <title> values', async ({
    page,
  }) => {
    await page.goto('/');
    const homeTitle = await page.title();
    expect(homeTitle).toMatch(/wordspace/i);
    expect(homeTitle).not.toMatch(/coming soon/i);

    await page.goto('/downloads/linux');
    const linuxTitle = await page.title();
    expect(linuxTitle).toMatch(/coming soon/i);
    expect(linuxTitle).not.toBe(homeTitle);
  });
});
