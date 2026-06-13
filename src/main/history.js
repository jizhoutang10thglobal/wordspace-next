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

// 同毫秒并发保存会撞同名时间戳 → 进程内计数器加 _NNN 后缀保证每版唯一不覆盖。
// 用 '_'（ASCII 在 '.' 之后、又在 \w 内）：确保 ts_001 排在 ts 之后（保持时间序），
// 且不破坏 read() 的 /^[\w-]+\.html$/ 正则。
let _lastTs = null;
let _seq = 0;
function uniqueStamp() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (ts === _lastTs) _seq += 1; else { _lastTs = ts; _seq = 0; }
  return _seq === 0 ? ts : ts + '_' + String(_seq).padStart(3, '0');
}

async function archive(root, filePath, content) {
  const dir = dirFor(root, filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ path: filePath }), 'utf8');
  // wx（存在即失败）兜底：万一计数器没覆盖到，也绝不覆盖既有历史版本。
  let stamp = uniqueStamp();
  for (let i = 0; i < 50; i++) {
    try {
      await fs.writeFile(path.join(dir, stamp + '.html'), content, { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      stamp = uniqueStamp();
    }
  }
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
