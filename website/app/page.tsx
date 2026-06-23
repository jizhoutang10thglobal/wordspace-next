import { SiteHeader } from './components/SiteHeader';
import { Hero } from './components/Hero';
import { AutoUpdate } from './components/AutoUpdate';
import { SiteFooter } from './components/SiteFooter';
import { SITE_DESCRIPTION, SITE_URL } from './lib/site-config';

// The home page deliberately does NOT export its own `metadata` — it
// inherits the layout's defaults (title, description, canonical '/',
// openGraph, twitter) so there's no chance of a partial override silently
// wiping `openGraph.images` or the Twitter card.

const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}/#software`,
  name: 'wordspace',
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'macOS, Windows',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  downloadUrl: [
    `${SITE_URL}/downloads/mac`,
    `${SITE_URL}/downloads/mac-intel`,
    `${SITE_URL}/downloads/win`,
  ],
  softwareHelp: {
    '@type': 'CreativeWork',
    url: SITE_URL,
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify output is safe (no user input), so dangerouslySet
        // here is the standard Next.js idiom for inline structured data.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
      />
      <SiteHeader />
      <main>
        <Hero />
        <AutoUpdate />
      </main>
      <SiteFooter />
    </>
  );
}
