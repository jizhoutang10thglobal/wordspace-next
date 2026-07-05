const fs = require('fs/promises');

async function readDoc(p) {
  return fs.readFile(p, 'utf8');
}

async function readDocBuffer(p) {
  return fs.readFile(p);
}

let tmpSeq = 0;

// opts.allowWhitespaceOnly：md 后端专用。清空后的 md 序列化成 '\n'（一个换行 = 合法空 md），
// 但 '\n'.trim() 为空 → 原来的「拒空」守卫把它也拦了 → 清空 md 后每次自动保存都抛 ENOENT（修 MD-1）。
// 该选项只放行「纯空白但非零长度」，真正 length===0 仍拒（守住「防误清空成空文件」的初衷）。
async function writeDocSafe(p, content, opts = {}) {
  const allowWs = opts.allowWhitespaceOnly === true;
  const empty = typeof content !== 'string' || (allowWs ? content.length === 0 : content.trim().length === 0);
  if (empty) throw new Error('refusing to write empty content: ' + p);
  // 修 MP-2：tmp 名带 pid+序号，避免同一文件并发保存（自动保存在飞时按 Cmd+S）共用固定 '.ws2tmp' 互相
  // 覆盖/删除 → 一方 rename 撞 ENOENT 或读到空 tmp、弹假报错。各写各的 tmp，两次 rename 到同一正本各自原子、后者赢。
  const tmp = p + '.ws2tmp-' + process.pid + '-' + (tmpSeq++);
  await fs.writeFile(tmp, content, 'utf8');
  try {
    const st = await fs.stat(tmp);
    if (!allowWs && st.size === 0) {
      throw new Error('tmp file is empty, aborting: ' + p);
    }
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

module.exports = { readDoc, readDocBuffer, writeDocSafe };
