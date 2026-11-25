import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stamp } from '../scripts/stamp.mjs';

test('stamp agrega la versión a scripts, estilos, módulos y logos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.mkdirSync(path.join(dir, 'js'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<link rel="stylesheet" href="css/styles.css" /><link rel="modulepreload" href="js/app.js" /><script type="module" src="js/app.js"></script><img src="assets/inicio.webp">');
  fs.writeFileSync(path.join(dir, 'js', 'app.js'), "import { a } from './config.js';\nimport { b } from './logic.js';\n");
  fs.writeFileSync(path.join(dir, 'js', 'config.js'), "export const L = [{ logo: 'assets/unesi.webp' }, { logo: 'assets/blanco-v2.svg' }];\n");
  stamp(dir, 'abc123');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /css\/styles\.css\?v=abc123/);
  assert.equal((html.match(/js\/app\.js\?v=abc123/g) || []).length, 2);
  assert.match(html, /assets\/inicio\.webp\?v=abc123/);
  const app = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  assert.match(app, /'\.\/config\.js\?v=abc123'/);
  assert.match(app, /'\.\/logic\.js\?v=abc123'/);
  const cfg = fs.readFileSync(path.join(dir, 'js', 'config.js'), 'utf8');
  assert.match(cfg, /assets\/unesi\.webp\?v=abc123/);
  assert.match(cfg, /assets\/blanco-v2\.svg\?v=abc123/);
  stamp(dir, 'abc123'); // idempotente: no duplica la versión
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8'), /\?v=abc123\?v=/);
});
