import { SiteHeader } from './components/SiteHeader';
import { Hero } from './components/Hero';
import { FeatureTrio } from './components/FeatureTrio';
import { CopyPromptDemo } from './components/CopyPromptDemo';
import { FAQ } from './components/FAQ';
import { SiteFooter } from './components/SiteFooter';
import { FAQ_ITEMS } from './lib/faq-data';
import { SITE_DESCRIPTION, SITE_URL } from './lib/site-config';

// The home page deliberately does NOT export its own `metadata` — it
// inherits the layout's defaults (title, description, canonical '/',
// openGraph, twitter) so there's no chance of a partial override silently
// wiping `openGraph.images` or the Twitter card. Per-page metadata lives
// on sub-routes like /downloads/linux.

// Shared across the SoftwareApplication + FAQPage entries so one graph
// object is easier for crawlers to navigate than two orphan blocks.
const softwareApplicationSchema = {
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}/#software`,
  name: 'wordspace',
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  // schema.org canonical SoftwareApplication subclass most products in
  // this category use (Notion, Google Docs, etc.). Google Rich Results
  // accepts free-form strings too, but "BusinessApplication" validates
  // cleanly.
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'macOS, Windows',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  downloadUrl: [`${SITE_URL}/downloads/mac`, `${SITE_URL}/downloads/win`],
  // Public release mirror; source repo is intentionally private.
  softwareHelp: {
    '@type': 'CreativeWork',
    url: 'https://github.com/jizhoutang10thglobal/wordspace-releases',
  },
};

const faqPageSchema = {
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/#faq`,
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
};

const jsonLdGraph = {
  '@context': 'https://schema.org',
  '@graph': [softwareApplicationSchema, faqPageSchema],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify output is safe (no user input), so dangerouslySet
        // here is the standard Next.js idiom for inline structured data.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdGraph) }}
      />
      <SiteHeader />
      <main>
        <Hero />
        <FeatureTrio />
        <CopyPromptDemo />
        <FAQ />
      </main>
      <SiteFooter />
    </>
  );
}
