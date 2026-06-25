// 持久化「上次打开的工作区文件夹」+「每个工作区的置顶文件」，重启后自动恢复。照 recents.js：
// 一个 userData 下的小 JSON，只从主进程读写，store 路径作参数传入 → node:test 用 tmpdir 直接驱动。
// 损坏/缺失返回 null（不抛）。pins 按根存（pinsByRoot[root]=[rel...]），换工作区各自保留。
const fs = require('fs/promises');
const path = require('path');

async function readRaw(storeFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(storeFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
async function writeRaw(storeFile, raw) {
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify(raw, null, 2), 'utf8');
}

async function load(storeFile) {
  const raw = await readRaw(storeFile);
  return typeof raw.root === 'string' ? raw : null;
}

async function save(storeFile, root) {
  const raw = await readRaw(storeFile); // 保留 pinsByRoot，别被覆盖
  raw.root = root;
  raw.savedAt = Date.now();
  await writeRaw(storeFile, raw);
  return { root };
}

// 取某根的置顶列表（rel 路径数组）。缺失/损坏 → []。
async function getPins(storeFile, root) {
  const raw = await readRaw(storeFile);
  const list = raw.pinsByRoot && raw.pinsByRoot[root];
  return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
}

// 设某根的置顶列表。
async function setPins(storeFile, root, pins) {
  const raw = await readRaw(storeFile);
  if (!raw.pinsByRoot || typeof raw.pinsByRoot !== 'object') raw.pinsByRoot = {};
  raw.pinsByRoot[root] = Array.isArray(pins) ? pins.filter((p) => typeof p === 'string') : [];
  await writeRaw(storeFile, raw);
  return raw.pinsByRoot[root];
}

async function clear(storeFile) {
  await fs.rm(storeFile, { force: true }).catch(() => {});
}

module.exports = { load, save, clear, getPins, setPins };
