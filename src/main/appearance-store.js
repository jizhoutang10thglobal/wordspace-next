// 外观偏好持久化（userData/appearance.json { version, pref }）。三态：system/light/dark。
// 偏好改动很稀疏（用户偶尔切），每次同步原子写即可，不需 browser-store 那套防抖/flush。
// 只从主进程读写；路径作参数传入 → node:test 可用 tmpdir 直接驱动。
const fs = require('fs');
const path = require('path');
const { normalizePref } = require('../lib/appearance');

let file = null;
let current = 'system';

// 启动读盘 → 返回归一化后的当前偏好（缺省/损坏 → 'system'）。
function init(userDataDir) {
  file = path.join(userDataDir, 'appearance.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    current = normalizePref(raw && raw.pref);
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
  current = normalizePref(pref);
  if (file) {
    try {
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, pref: current }, null, 2), 'utf8');
      fs.renameSync(tmp, file); // 原子：坏了只坏 tmp
    } catch (e) {
      console.error('[appearance-store] write failed:', e && e.message);
    }
  }
  return current;
}

module.exports = { init, getPref, setPref };
