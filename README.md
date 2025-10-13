# Football Competition Modding Editor

This project provides a modern foundation for editing the eight text files that
define a football competition database. It ships with a small Express backend
and a Tailwind-powered single-page frontend.

## Features

- 📁 File parser for all eight text files (`compobj`, `settings`, `advancement`,
  `schedule`, `standings`, `tasks`, `weather`, `objectives`).
- ✅ Validation engine that cross-references IDs, parent relationships, and basic
  formatting rules before export.
- 🧽 Auto-fix endpoint that tidies stage names (hyphens → underscores) and trims
  stray placeholder spaces.
- 🧾 Export endpoint that generates a `.zip` archive ready to be imported by the
  game without extra whitespace or BOM changes.
- 🌳 Frontend explorer with a collapsible tree, validation results, and download
  actions.

## Getting Started

1. Install dependencies (requires access to the public npm registry):

   ```bash
   npm install
   ```

   > If npm access is blocked, you can still review the source files and wire
   > them into your own environment manually.

2. Start the backend server:

   ```bash
   npm start
   ```

   The server listens on `http://localhost:3000` by default.

3. Open `frontend/index.html` in a browser. Use the UI to load the eight text
   files, parse them, and run validations.

## Project Structure

```
backend/
  server.js            # Express server with parse, validate, autofix, export routes
  lib/
    csv.js             # CSV helpers that preserve blank fields
    parser.js          # Parsers for each file type
    validator.js       # Cross-file validation routines
    autofix.js         # Hygiene helpers (stage name cleanup, blank trimming)
    exporter.js        # Zip generation helper
frontend/
  index.html           # Tailwind SPA that calls the backend
```

## Roadmap

- Implement `/applyEdit` and `/rebase` endpoints with transactional rewrites.
- Extend the UI with form-based editing, undo/redo, and contextual insertion
  previews.
- Provide richer validation (advancement cycles, schedule ordering, task
  argument limits).

Contributions and bug reports are welcome!
