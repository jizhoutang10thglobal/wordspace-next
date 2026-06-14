import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '../../components/SiteHeader';
import { SiteFooter } from '../../components/SiteFooter';

export const metadata: Metadata = {
  title: 'Linux build — coming soon',
  description:
    'A native Linux build of wordspace is on the roadmap. Grab the macOS or Windows build in the meantime — the REST API and Copy Prompt flow are identical across platforms.',
  alternates: {
    canonical: '/downloads/linux',
  },
  // Next.js metadata merging replaces nested objects wholesale — if any
  // of openGraph/twitter fields are overridden here, every other field
  // from the layout is dropped. Re-declare the full shape explicitly so
  // `og:image` and `twitter:card` survive.
  openGraph: {
    type: 'website',
    url: '/downloads/linux',
    siteName: 'wordspace',
    title: 'Linux build — coming soon · wordspace',
    description:
      'A native Linux build of wordspace is on the roadmap. Download macOS or Windows in the meantime.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'wordspace — headless AI document editor',
      },
    ],
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Linux build — coming soon · wordspace',
    description:
      'A native Linux build of wordspace is on the roadmap. Download macOS or Windows in the meantime.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

export default function LinuxComingSoonPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="placeholder">
          <span className="placeholder__eyebrow">Linux build</span>
          <h1 className="placeholder__title">Coming soon</h1>
          <p className="placeholder__body">
            A native Linux build of wordspace is on our roadmap but not available yet.
            In the meantime, the macOS and Windows builds cover everything — the REST
            API and Copy Prompt flow are identical across platforms.
          </p>
          <div className="hero__ctas">
            <Link className="cta" href="/">
              Back to home
            </Link>
            <a className="cta cta--secondary" href="/downloads/mac">
              Download for macOS
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
