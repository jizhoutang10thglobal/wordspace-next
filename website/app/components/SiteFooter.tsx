import Link from 'next/link';

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>© {year} Tenth Global Limited</span>
        <nav className="site-footer__links">
          <Link href="/changelog">更新日志</Link>
        </nav>
      </div>
    </footer>
  );
}
