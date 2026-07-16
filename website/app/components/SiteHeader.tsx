import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="site-header__brand" aria-label="wordspace.ai home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="site-header__logo"
            src="/wordspace-wordmark-black.png"
            alt="wordspace.ai"
            width={2179}
            height={569}
          />
        </Link>
        <nav className="site-header__nav">
          <Link href="/changelog" data-testid="nav-changelog">
            更新日志
          </Link>
        </nav>
      </div>
    </header>
  );
}
