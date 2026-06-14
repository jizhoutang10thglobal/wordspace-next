const FEATURES = [
  {
    num: '01',
    title: 'No AI inside',
    body:
      'wordspace has no built-in model. You keep full control of the prompt, model, and tooling. Use Claude Code, Cursor, or your own agent — swap anytime without migrating documents.',
  },
  {
    num: '02',
    title: 'Copy Prompt bridges it',
    body:
      'One click copies a ready-to-paste prompt with the local API base URL and your key. Paste into your AI tool and it immediately knows how to read and write your open document.',
  },
  {
    num: '03',
    title: '.wsp files, auto-saved, live-synced',
    body:
      'Every AI edit persists to a native .wsp file on disk. WebSocket pushes changes back into the editor instantly, so you and the AI always see the same state.',
  },
];

export function FeatureTrio() {
  return (
    <section className="section features" id="features">
      <div className="container">
        <h2 className="features__title">A simple editor. An AI-shaped hole.</h2>
        <div className="features__grid">
          {FEATURES.map((f) => (
            <article key={f.num} className="feature">
              <div className="feature__num">{f.num}</div>
              <h3 className="feature__title">{f.title}</h3>
              <p className="feature__body">{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
