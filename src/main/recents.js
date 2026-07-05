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
  // 修 MP-11：原子写（tmp+rename），防写一半崩溃损坏 JSON → 最近列表静默清空。
  const tmp = storeFile + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
  await fs.rename(tmp, storeFile);
  return trimmed;
}

module.exports = { load, add, MAX };
