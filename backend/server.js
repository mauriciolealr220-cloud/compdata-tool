'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const { Workspace, FILE_ORDER } = require('./lib/workspace');
const { parseFiles } = require('./lib/parser');
const { validateAll } = require('./lib/validator');
const { createZip } = require('./lib/exporter');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const DATA_DIR = path.resolve(__dirname, 'data');

const workspace = new Workspace(DATA_DIR);
const workspaceReady = workspace
  .loadAll()
  .then(() => {
    console.log('CompData workspace loaded.');
  })
  .catch(error => {
    console.error('Failed to load workspace', error);
    process.exit(1);
  });

function canonicalName(name) {
  const lookup = String(name || '').toLowerCase();
  const match = FILE_ORDER.find(item => item.toLowerCase() === lookup);
  if (!match) {
    throw new Error(`Unsupported file: ${name}`);
  }
  return match;
}

function wrapAsync(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function respondWorkspace(res) {
  res.json({ ok: true, ...workspace.describe() });
}

app.get(
  '/api/state',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    respondWorkspace(res);
  })
);

app.get(
  '/api/file/:name',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const name = canonicalName(req.params.name);
    res.json({ ok: true, file: workspace.getFileState(name), status: workspace.getStatus() });
  })
);

app.post(
  '/api/insert/:name',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const name = canonicalName(req.params.name);
    workspace.insertRow(name, req.body || {});
    respondWorkspace(res);
  })
);

app.post(
  '/api/delete/:name',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const name = canonicalName(req.params.name);
    const { rowIds } = req.body || {};
    workspace.deleteRows(name, Array.isArray(rowIds) ? rowIds : []);
    respondWorkspace(res);
  })
);

app.post(
  '/api/edit/:name',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const name = canonicalName(req.params.name);
    const { rowId, field, value } = req.body || {};
    if (!rowId || !field) {
      throw new Error('Edit requests must include rowId and field.');
    }
    workspace.updateCell(name, rowId, field, value);
    respondWorkspace(res);
  })
);

app.post(
  '/api/reorder/:name',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const name = canonicalName(req.params.name);
    const { order } = req.body || {};
    workspace.reorder(name, Array.isArray(order) ? order : []);
    respondWorkspace(res);
  })
);

app.post(
  '/api/recalculate',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    workspace.recalculate();
    respondWorkspace(res);
  })
);

app.post(
  '/api/save',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const result = await workspace.saveAll();
    res.json({ ok: true, save: result, ...workspace.describe() });
  })
);

app.post(
  '/api/validate',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const files = workspace.serializeAll();
    const parsed = parseFiles(files);
    const result = validateAll(parsed);
    res.json({ ok: result.ok, issues: result.issues });
  })
);

app.get(
  '/api/export',
  wrapAsync(async (req, res) => {
    await workspaceReady;
    const files = workspace.serializeAll();
    const buffer = await createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="compdata-workspace.zip"');
    res.send(buffer);
  })
);

app.use(express.static(FRONTEND_DIR));

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);
  const status = error.status || 400;
  res.status(status).json({ ok: false, error: error.message || 'Unexpected error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CompData Studio listening on port ${PORT}`);
});
