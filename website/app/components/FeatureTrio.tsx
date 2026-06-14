const FEATURES = [
  {
    num: '01',
    title: 'Your real files',
    body:
      'Open any .html document and edit it in place. Wordspace Next saves back to clean, standard HTML — no private format, no lock-in.',
  },
  {
    num: '02',
    title: 'Edit like a doc',
    body:
      'Headings, lists, bold, highlight, tables, and images. Content you don’t touch — tables, embedded media — is kept exactly as it was.',
  },
  {
    num: '03',
    title: 'Local and private',
    body:
      'Everything stays on your machine. No account, no cloud, no telemetry. Updates download and install themselves, signed and notarized.',
  },
];

export function FeatureTrio() {
  return (
    <section className="section features" id="features">
      <div className="container">
        <h2 className="features__title">What you get.</h2>
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
