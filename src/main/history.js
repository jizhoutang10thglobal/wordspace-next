const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAX_VERSIONS = 20;

function keyFor(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function dirFor(root, filePath) {
  return path.join(root, keyFor(filePath));
}

async function archive(root, filePath, content) {
  const dir = dirFor(root, filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ path: filePath }), 'utf8');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.writeFile(path.join(dir, ts + '.html'), content, 'utf8');
  const entries = (await fs.readdir(dir)).filter(f => f.endsWith('.html')).sort();
  while (entries.length > MAX_VERSIONS) {
    await fs.unlink(path.join(dir, entries.shift()));
  }
}

async function list(root, filePath) {
  try {
    const entries = await fs.readdir(dirFor(root, filePath));
    return entries
      .filter(f => f.endsWith('.html'))
      .sort()
      .reverse()
      .map(f => ({ id: f, ts: f.replace('.html', '') }));
  } catch {
    return [];
  }
}

async function read(root, filePath, id) {
  if (!/^[\w-]+\.html$/.test(id)) throw new Error('bad version id: ' + id);
  return fs.readFile(path.join(dirFor(root, filePath), id), 'utf8');
}

module.exports = { archive, list, read, keyFor, MAX_VERSIONS };
