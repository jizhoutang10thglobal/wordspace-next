const path = require('path');

function getWindowConfig() {
  return {
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.resolve(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

module.exports = { getWindowConfig };
