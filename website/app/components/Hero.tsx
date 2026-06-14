export function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <span className="hero__eyebrow">Headless AI document editor</span>
        <h1 className="hero__title">
          Your document editor, <em>bring your own AI</em>.
        </h1>
        <p className="hero__subtitle">
          wordspace is a clean, native document editor with no AI inside. Copy one prompt,
          paste it into Claude Code, Cursor, or any agent, and let your AI edit the open
          document through a secure local REST API. Every change auto-saves to your{' '}
          <code>.wsp</code> file and refreshes instantly through WebSocket.
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
          Apple Silicon build for macOS · Windows installer · Linux{' '}
          <a href="/downloads/linux">coming soon</a>.
        </p>
      </div>
    </section>
  );
}
