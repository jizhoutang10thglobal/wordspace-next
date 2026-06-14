const DEMO_PROMPT = `You are connected to a wordspace document.

Base URL: http://127.0.0.1:3000
API Key:  ws_live_••••••••••••••••

Read / write the currently open document:
  GET  /api/doc             → { content, pageSize, filePath, ... }
  PUT  /api/doc             → partial update, auto-saved to .wsp
  POST /api/wsp/create      → create a new .wsp in ~/Documents/Wordspace/
  POST /api/files/open      → open a .wsp by path

All writes persist to disk. The user sees every edit in real time.`;

const STEPS = [
  {
    title: 'Click Copy Prompt',
    body:
      'The toolbar button copies a connection prompt — base URL and API key — to your clipboard. Nothing leaves your machine.',
  },
  {
    title: 'Paste into your AI',
    body:
      'Drop it into Claude Code, Cursor, or any agent that can call HTTP APIs. Your AI now knows how to read and edit the open document.',
  },
  {
    title: 'Watch it edit live',
    body:
      'The AI calls the local API. Every change auto-saves to your .wsp file. The editor re-renders instantly through WebSocket.',
  },
];

export function CopyPromptDemo() {
  return (
    <section className="section prompt-demo" id="how-it-works">
      <div className="container">
        <h2 className="prompt-demo__title">How it works</h2>
        <p className="prompt-demo__lede">
          Three steps. One prompt. Any AI tool.
        </p>
        <div className="prompt-demo__layout">
          <ol className="prompt-demo__steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <div className="prompt-demo__step-title">{s.title}</div>
                <div className="prompt-demo__step-body">{s.body}</div>
              </li>
            ))}
          </ol>
          <aside
            className="prompt-demo__panel"
            aria-label="Illustrative Copy Prompt output"
          >
            <div className="prompt-demo__panel-label">
              <span>Copy Prompt — illustrative</span>
              <span className="prompt-demo__placeholder">Example</span>
            </div>
            <pre className="prompt-demo__code">{DEMO_PROMPT}</pre>
          </aside>
        </div>
      </div>
    </section>
  );
}
