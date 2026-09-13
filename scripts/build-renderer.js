const { build } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'src', 'renderer');
const outDir = path.join(root, 'dist', 'renderer');
const assets = ['index.html', 'styles.css'];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(sourceDir, 'app.ts')],
    outfile: path.join(outDir, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome124',
    logLevel: 'warning',
  });

  for (const asset of assets) {
    fs.copyFileSync(path.join(sourceDir, asset), path.join(outDir, asset));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
