const fs = require('fs');
const { getBuiltinDocPath, loadBuiltinDocument } = require('../doc-loader');

describe('doc-loader', () => {
  it('loadBuiltinDocument returns HTML string containing the title marker', () => {
    const html = loadBuiltinDocument();
    expect(typeof html).toBe('string');
    expect(html).toContain('Wordspace');
  });

  it('builtin doc file exists and is non-empty', () => {
    const docPath = getBuiltinDocPath();
    expect(fs.existsSync(docPath)).toBe(true);
    const content = loadBuiltinDocument();
    expect(content.length).toBeGreaterThan(0);
  });

  it('loadBuiltinDocument throws a descriptive Error for a missing path', () => {
    expect(() => loadBuiltinDocument('/nonexistent/path/doc.html')).toThrow(Error);
    expect(() => loadBuiltinDocument('/nonexistent/path/doc.html')).toThrow(
      'Built-in document not found'
    );
  });
});
