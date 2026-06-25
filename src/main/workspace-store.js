// 持久化「上次打开的工作区文件夹」，重启后自动恢复。照 recents.js：一个 userData 下的小 JSON，
// 只从主进程读写，store 路径作参数传入 → node:test 用 tmpdir 直接驱动。损坏/缺失返回 null（不抛）。
const fs = require('fs/promises');
const path = require('path');

async function load(storeFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(storeFile, 'utf8'));
    return parsed && typeof parsed.root === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function save(storeFile, root) {
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify({ root, savedAt: Date.now() }, null, 2), 'utf8');
  return { root };
}

async function clear(storeFile) {
  await fs.rm(storeFile, { force: true }).catch(() => {});
}

module.exports = { load, save, clear };
