export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>© {year} 10thglobal</span>
      </div>
    </footer>
  );
}
