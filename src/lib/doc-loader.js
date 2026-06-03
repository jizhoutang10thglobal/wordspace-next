const fs = require('fs');
const path = require('path');

function getBuiltinDocPath() {
  return path.resolve(__dirname, '../assets/builtin-doc.html');
}

function loadBuiltinDocument(docPath) {
  const target = docPath || getBuiltinDocPath();
  if (!fs.existsSync(target)) {
    throw new Error('Built-in document not found: ' + target);
  }
  return fs.readFileSync(target, 'utf8');
}

module.exports = { getBuiltinDocPath, loadBuiltinDocument };
