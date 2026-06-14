import type { MetadataRoute } from 'next';

const SITE_URL = 'https://wordspace.ai';

export default function sitemap(): MetadataRoute.Sitemap {
  // Use build time as the lastmod so every production deploy announces a
  // freshness signal. Accurate enough for a one-page site.
  const now = new Date();

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
