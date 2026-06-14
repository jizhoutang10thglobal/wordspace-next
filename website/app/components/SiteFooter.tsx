export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>© {year} wordspace. All rights reserved.</span>
        <nav className="site-footer__links" aria-label="Footer">
          <a
            href="https://github.com/jizhoutang10thglobal/wordspace-releases"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://github.com/jizhoutang10thglobal/wordspace-releases/releases"
            target="_blank"
            rel="noopener noreferrer"
          >
            Release notes
          </a>
          <a href="/downloads/mac">Download macOS</a>
          <a href="/downloads/win">Download Windows</a>
          <a href="/downloads/linux">Linux</a>
        </nav>
      </div>
    </footer>
  );
}
