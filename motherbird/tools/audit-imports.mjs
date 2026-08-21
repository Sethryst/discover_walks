#!/usr/bin/env node
/**
 * check-imports.mjs
 *
 * Scans ./js for broken ES module imports.
 *
 * Finds:
 * - importing something that is not exported
 * - wrong module paths
 * - missing exports after refactors
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsDir = path.join(root, 'js');

const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
}

walk(jsDir);

const exportMap = new Map();

function exportedNames(file) {
  if (exportMap.has(file)) return exportMap.get(file);
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  const declarationRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = declarationRegex.exec(src))) names.add(match[1]);
  const listRegex = /export\s+\{([^}]+)\}/g;
  while ((match = listRegex.exec(src))) match[1].split(',').map((item) => item.trim()).filter(Boolean).forEach((item) => names.add(item.split(/\s+as\s+/).at(-1)));
  if (/export\s+default\s+/.test(src)) names.add('default');
  exportMap.set(file, names);
  return names;
}

for (const file of files) {
  exportedNames(file);
}


const importRegex =
  /import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s+from\s+['"](\.[^'"]+)['"]/g;


const issues = [];


for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const current = path.basename(file);

  let match;

  while ((match = importRegex.exec(src))) {

    const imported = match[1]
      ? match[1]
          .split(',')
          .map(x => x.trim().split(/\s+as\s+/)[0])
          .filter(Boolean)
      : ['default'];


    const targetFile = path.resolve(path.dirname(file), match[3].endsWith('.js') ? match[3] : `${match[3]}.js`);


    for (const name of imported) {

      if (name === 'default') continue;

      const exports = exportedNames(targetFile);

      if (!exports || !exports.has(name)) {
        issues.push(
          `${current} imports ${name} from ${match[3]} but ${path.basename(targetFile)} does not export it`
        );
      }
    }
  }
}


if (issues.length) {
  console.log('\nImport/export problems found:\n');

  issues.forEach(issue => console.log('❌ ' + issue));

  process.exit(1);
}

console.log('✅ No import/export mismatches found.');
