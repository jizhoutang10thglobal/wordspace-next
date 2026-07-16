// 语言偏好持久化（userData/language.json { version, pref }）。三态：system/zh/en。
// 与 appearance-store 同款：改动稀疏、每次同步原子写；只从主进程读写；路径作参数 → node:test 可驱动。
const fs = require('fs');
const path = require('path');
const { normalizeLangPref } = require('../lib/i18n');

let file = null;
let current = 'system';

// 启动读盘 → 返回归一化后的当前偏好（缺省/损坏 → 'system'）。
function init(userDataDir) {
  file = path.join(userDataDir, 'language.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    current = normalizeLangPref(raw && raw.pref);
  } catch {
    current = 'system';
  }
  return current;
}

function getPref() {
  return current;
}

// 设新偏好 + 原子写盘。返回归一化后的实际值。
function setPref(pref) {
  current = normalizeLangPref(pref);
  if (file) {
    try {
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, pref: current }, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[language-store] write failed:', e && e.message);
    }
  }
  return current;
}

module.exports = { init, getPref, setPref };
