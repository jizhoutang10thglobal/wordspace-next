const fs = require('fs/promises');
const path = require('path');

const MAX = 10;

async function load(storeFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(storeFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function add(storeFile, docPath) {
  const list = (await load(storeFile)).filter(r => r.path !== docPath);
  list.unshift({ path: docPath, openedAt: Date.now() });
  const trimmed = list.slice(0, MAX);
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

module.exports = { load, add, MAX };
