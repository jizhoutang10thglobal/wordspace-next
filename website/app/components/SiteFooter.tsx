export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>© {year} Wordspace Next</span>
        <nav className="site-footer__links" aria-label="Footer">
          <a
            href="https://github.com/jizhoutang10thglobal/wordspace-next"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://github.com/jizhoutang10thglobal/wordspace-next/releases"
            target="_blank"
            rel="noopener noreferrer"
          >
            Release notes
          </a>
          <a href="/downloads/mac">Download macOS</a>
          <a href="/downloads/win">Download Windows</a>
        </nav>
      </div>
    </footer>
  );
}
