export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>© {year} Tenth Global Limited</span>
      </div>
    </footer>
  );
}
