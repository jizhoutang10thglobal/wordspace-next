export function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <span className="hero__eyebrow">Desktop app · macOS &amp; Windows</span>
        <h1 className="hero__title">
          Edit HTML <em>like a document</em>.
        </h1>
        <p className="hero__subtitle">
          Wordspace Next opens your .html files and lets you write and format them
          like a normal doc — headings, lists, tables, images — then saves straight
          back to clean HTML. It runs on your own machine. No cloud, no account.
        </p>
        <div className="hero__ctas">
          <a className="cta" href="/downloads/mac" data-testid="cta-mac">
            <span aria-hidden="true">⌘</span>
            Download for macOS
          </a>
          <a className="cta cta--secondary" href="/downloads/win" data-testid="cta-win">
            <span aria-hidden="true">⊞</span>
            Download for Windows
          </a>
        </div>
        <p className="hero__ctas-note">
          Apple Silicon build for macOS · Windows installer · updates itself automatically.
        </p>
      </div>
    </section>
  );
}
