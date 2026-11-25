// Huella de versión para que los navegadores (sobre todo Safari) siempre bajen la última versión.
// Vercel lo ejecuta en cada despliegue (buildCommand en vercel.json) sobre su copia de public/;
// los archivos del repositorio no cambian.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const add = (url, v) => (url.includes('?v=') ? url : `${url}?v=${v}`);

export function stamp(dir, version) {
  const v = String(version).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'dev';

  // index.html: hojas de estilo, scripts, modulepreload e imágenes locales
  const htmlPath = path.join(dir, 'index.html');
  const html = fs
    .readFileSync(htmlPath, 'utf8')
    .replace(/(href|src)="((?:css|js|assets)\/[^"?]+)(\?v=[^"]*)?"/g, (_m, attr, url, q) => `${attr}="${q ? url + q : add(url, v)}"`);
  fs.writeFileSync(htmlPath, html);

  // módulos JS: imports relativos y rutas de logos
  const jsDir = path.join(dir, 'js');
  for (const name of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js'))) {
    const p = path.join(jsDir, name);
    const src = fs
      .readFileSync(p, 'utf8')
      .replace(/(from\s+|import\(\s*)'(\.\/[\w-]+\.js)(\?v=[^']*)?'/g, (_m, pre, url, q) => `${pre}'${q ? url + q : add(url, v)}'`)
      .replace(/'(assets\/[\w.-]+\.(?:webp|svg|png|jpg))(\?v=[^']*)?'/g, (_m, url, q) => `'${q ? url + q : add(url, v)}'`);
    fs.writeFileSync(p, src);
  }
  return v;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2] || 'public';
  const version = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36);
  console.log('Versión de los archivos:', stamp(dir, version));
}
