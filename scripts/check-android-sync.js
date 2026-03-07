#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const androidAssetsWebRoot = path.join(repoRoot, 'android-app', 'app', 'src', 'main', 'assets', 'www');

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

if (!exists(androidAssetsWebRoot)) {
  console.log('[check-android-sync] OK: no embedded web bundle under android-app/assets/www (single source of truth mode).');
  process.exit(0);
}

const risky = ['app.js', 'index.html', 'styles.css'];
const found = risky.filter((name) => exists(path.join(androidAssetsWebRoot, name)));
if (found.length) {
  console.error('[check-android-sync] FAIL: duplicated web business files detected in android assets:', found.join(', '));
  console.error('Use hosted-web mode or add explicit sync pipeline before committing duplicated assets.');
  process.exit(1);
}

console.log('[check-android-sync] OK: android assets/www exists but without duplicated core web business files.');
