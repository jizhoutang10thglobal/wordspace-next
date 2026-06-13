const fs = require('fs/promises');

async function readDoc(p) {
  return fs.readFile(p, 'utf8');
}

async function readDocBuffer(p) {
  return fs.readFile(p);
}

async function writeDocSafe(p, content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('refusing to write empty content: ' + p);
  }
  const tmp = p + '.ws2tmp';
  await fs.writeFile(tmp, content, 'utf8');
  try {
    const st = await fs.stat(tmp);
    if (st.size === 0) {
      throw new Error('tmp file is empty, aborting: ' + p);
    }
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

module.exports = { readDoc, readDocBuffer, writeDocSafe };
