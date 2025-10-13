'use strict';

const JSZip = require('jszip');
const { FILE_KEYS } = require('./parser');

async function createZip(files) {
  const zip = new JSZip();
  FILE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(files, key)) {
      const content = files[key];
      zip.file(key, typeof content === 'string' ? content : '');
    }
  });
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return buffer;
}

module.exports = {
  createZip,
};
