'use strict';

const express = require('express');
const cors = require('cors');
const { parseFiles, FILE_KEYS } = require('./lib/parser');
const { validateAll } = require('./lib/validator');
const { autoFix } = require('./lib/autofix');
const { createZip } = require('./lib/exporter');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function normaliseFiles(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object.');
  }
  const files = payload.files;
  if (!files || typeof files !== 'object') {
    throw new Error('Request must include a "files" object.');
  }
  const result = {};
  FILE_KEYS.forEach(key => {
    const match = Object.keys(files).find(name => name.toLowerCase() === key);
    if (!match) {
      throw new Error(`Missing required file: ${key}`);
    }
    result[key] = String(files[match]);
  });
  return result;
}

app.post('/parse', (req, res) => {
  try {
    const files = normaliseFiles(req.body);
    const model = parseFiles(files);
    res.json({ ok: true, model });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/validate', (req, res) => {
  try {
    const files = normaliseFiles(req.body);
    const model = parseFiles(files);
    const validation = validateAll(model);
    res.json({ ok: validation.ok, issues: validation.issues });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/autofix', (req, res) => {
  try {
    const files = normaliseFiles(req.body);
    const fixed = autoFix(files);
    res.json({ ok: true, files: fixed });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/export', async (req, res) => {
  try {
    const files = normaliseFiles(req.body);
    const zipBuffer = await createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="mod-export.zip"');
    res.send(zipBuffer);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/applyEdit', (req, res) => {
  res.status(501).json({ ok: false, error: 'Editing endpoints are not yet implemented.' });
});

app.post('/rebase', (req, res) => {
  res.status(501).json({ ok: false, error: 'Rebase endpoint is not yet implemented.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Football modding backend listening on port ${PORT}`);
});
