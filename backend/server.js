'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { parseFiles, FILE_KEYS } = require('./lib/parser');
const { validateAll } = require('./lib/validator');
const { autoFix } = require('./lib/autofix');
const { createZip } = require('./lib/exporter');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const frontendDir = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

const DATA_DIR = path.resolve(__dirname, '..', 'compdata');
const CURRENT_FILE_PATH = (() => {
  const preferred = path.join(DATA_DIR, 'compobj.TXT');
  if (fs.existsSync(preferred)) {
    return preferred;
  }
  return path.join(DATA_DIR, 'compobj.txt');
})();
const DEFAULT_FILE_PATH = (() => {
  const localPreferred = path.resolve(__dirname, '..', 'compobj.txt');
  if (fs.existsSync(localPreferred)) {
    return localPreferred;
  }
  const alt = path.join(DATA_DIR, 'compobj_default.TXT');
  return alt;
})();

async function readCurrentFile() {
  return fsp.readFile(CURRENT_FILE_PATH, 'utf8');
}

async function writeCurrentFile(content) {
  await fsp.writeFile(CURRENT_FILE_PATH, content, 'utf8');
}

function parseCompobjLines(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  return lines.map((line, index) => {
    const parts = line.split(',');
    const [id, level, code, name, parent] = parts;
    return {
      id: Number(id),
      level: Number(level),
      code: code || '',
      name: name || '',
      parent: parent !== undefined ? Number(parent) : NaN,
      raw: line,
      lineNumber: index + 1,
    };
  });
}

app.get('/api/file/compobj.txt', async (req, res) => {
  try {
    const content = await readCurrentFile();
    res.json({ ok: true, content });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/file/compobj.txt', async (req, res) => {
  try {
    const { content } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'Request body must include a string "content" field.' });
    }
    await writeCurrentFile(content);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/validate/compobj', async (req, res) => {
  try {
    const content = await readCurrentFile();
    const nodes = parseCompobjLines(content);
    const issues = [];
    const ids = new Map();
    const byId = new Map();
    nodes.forEach(node => {
      if (!Number.isFinite(node.id)) {
        issues.push({ id: node.id, type: 'error', message: 'Invalid ID value', line: node.lineNumber });
      } else if (ids.has(node.id)) {
        issues.push({ id: node.id, type: 'error', message: 'Duplicate ID', line: node.lineNumber });
      }
      ids.set(node.id, node.lineNumber);
      byId.set(node.id, node);
      if (!Number.isFinite(node.level)) {
        issues.push({ id: node.id, type: 'error', message: 'Invalid level value', line: node.lineNumber });
      } else if (!Number.isInteger(node.level)) {
        issues.push({ id: node.id, type: 'error', message: 'Level must be an integer', line: node.lineNumber });
      }
      const trimmedCode = node.code.trim();
      if (!trimmedCode) {
        issues.push({ id: node.id, type: 'error', message: 'Missing code', line: node.lineNumber });
      }
      if (node.code !== trimmedCode) {
        issues.push({ id: node.id, type: 'warning', message: 'Code has leading or trailing spaces', line: node.lineNumber });
      }
      const trimmedName = node.name.trim();
      if (node.name !== trimmedName) {
        issues.push({ id: node.id, type: 'warning', message: 'Name has leading or trailing spaces', line: node.lineNumber });
      }
      if (!trimmedName) {
        issues.push({ id: node.id, type: 'warning', message: 'Name is blank', line: node.lineNumber });
      }
      if (trimmedCode.startsWith('S') && !trimmedName.startsWith('FCE_')) {
        issues.push({ id: node.id, type: 'warning', message: 'Stage name missing FCE_ prefix', line: node.lineNumber });
      }
    });

    nodes.forEach(node => {
      if (node.parent === node.id) {
        issues.push({ id: node.id, type: 'error', message: 'Node cannot be its own parent', line: node.lineNumber });
        return;
      }
      if (!Number.isFinite(node.parent)) {
        issues.push({ id: node.id, type: 'error', message: 'Invalid parent value', line: node.lineNumber });
        return;
      }
      if (node.level === 0) {
        return;
      }
      const parent = byId.get(node.parent);
      if (!parent) {
        issues.push({ id: node.id, type: 'error', message: `Missing parent ID ${node.parent}`, line: node.lineNumber });
        return;
      }
      if (Number.isFinite(parent.level) && node.level !== parent.level + 1) {
        issues.push({ id: node.id, type: 'error', message: 'Level must be exactly one greater than parent level', line: node.lineNumber });
      }
      const codePrefix = node.code.trim()[0];
      if (!['C', 'S', 'G'].includes(codePrefix)) {
        issues.push({ id: node.id, type: 'warning', message: 'Unexpected code prefix', line: node.lineNumber });
      }
    });

    res.json(issues);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/compare/compobj', async (req, res) => {
  try {
    const [currentContent, defaultContent] = await Promise.all([
      readCurrentFile(),
      fsp.readFile(DEFAULT_FILE_PATH, 'utf8').catch(() => ''),
    ]);
    const currentNodes = parseCompobjLines(currentContent);
    const defaultNodes = parseCompobjLines(defaultContent);
    const currentById = new Map(currentNodes.map(node => [node.id, node]));
    const defaultById = new Map(defaultNodes.map(node => [node.id, node]));
    const comparisons = [];

    currentById.forEach((node, id) => {
      if (!defaultById.has(id)) {
        comparisons.push({ id, type: 'added', current: node.raw, baseline: null });
      } else {
        const baseline = defaultById.get(id);
        if (baseline.raw !== node.raw) {
          comparisons.push({ id, type: 'changed', current: node.raw, baseline: baseline.raw });
        }
      }
    });

    defaultById.forEach((node, id) => {
      if (!currentById.has(id)) {
        comparisons.push({ id, type: 'removed', current: null, baseline: node.raw });
      }
    });

    res.json({ ok: true, differences: comparisons });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

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

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Football modding backend listening on port ${PORT}`);
});
