export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>© {year} 10thglobal</span>
        <nav className="site-footer__links" aria-label="页脚">
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
            更新日志
          </a>
        </nav>
      </div>
    </footer>
  );
}
