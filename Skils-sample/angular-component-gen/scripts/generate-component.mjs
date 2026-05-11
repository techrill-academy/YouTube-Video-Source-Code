#!/usr/bin/env node
/**
 * generate-component.mjs
 *
 * Scaffolds a standalone Angular 20 component from the templates in
 * ../assets/templates/. Used by the angular-component-gen skill *after*
 * the spec has been compressed via compress-spec.mjs.
 *
 * Usage:
 *   node generate-component.mjs --name feature-card --target src/app/components
 *   node generate-component.mjs --name feature-card --spec-file ./spec.txt
 *   node generate-component.mjs --name feature-card --spec "short inline spec"
 *   node generate-component.mjs --name feature-card --force
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'assets', 'templates');

function parseArgs(argv) {
  const args = {
    name: null,
    target: 'src/app/components',
    spec: '',
    specFile: null,
    force: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--spec') args.spec = argv[++i];
    else if (a === '--spec-file') args.specFile = argv[++i];
    else if (a === '--force') args.force = true;
  }
  return args;
}

function toKebab(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase();
}

function toPascal(s) {
  return toKebab(s)
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function applyTemplate(tmpl, vars) {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : `{{${k}}}`
  );
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.name) {
    process.stderr.write('Error: --name <component-name> is required.\n');
    process.exit(2);
  }

  const kebab = toKebab(args.name);
  const pascal = toPascal(args.name);
  const selector = `app-${kebab}`;
  const className = `${pascal}Component`;

  let spec = args.spec || '';
  if (args.specFile) {
    spec = fs.readFileSync(args.specFile, 'utf8');
  }
  // Keep the spec to a single short line (token-friendly).
  spec = spec.replace(/\s+/g, ' ').trim();
  if (spec.length > 200) spec = spec.slice(0, 197) + '...';
  const specComment = spec ? `// Spec: ${spec}\n` : '';

  const targetDir = path.resolve(REPO_ROOT, args.target, kebab);
  if (fs.existsSync(targetDir) && !args.force) {
    const files = fs.readdirSync(targetDir);
    if (files.length > 0) {
      process.stderr.write(
        `Error: ${path.relative(REPO_ROOT, targetDir)} already exists and is not empty. Use --force to overwrite.\n`
      );
      process.exit(3);
    }
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const vars = {
    selector,
    className,
    kebab,
    pascal,
    specComment,
  };

  const written = [];
  for (const [tmplName, outName] of [
    ['component.ts.tmpl', `${kebab}.ts`],
    ['component.html.tmpl', `${kebab}.html`],
    ['component.scss.tmpl', `${kebab}.scss`],
  ]) {
    const tmplPath = path.join(TEMPLATE_DIR, tmplName);
    const outPath = path.join(targetDir, outName);
    if (fs.existsSync(outPath) && !args.force) {
      process.stderr.write(`Skipping (exists): ${path.relative(REPO_ROOT, outPath)}\n`);
      continue;
    }
    const tmpl = fs.readFileSync(tmplPath, 'utf8');
    fs.writeFileSync(outPath, applyTemplate(tmpl, vars), 'utf8');
    written.push(path.relative(REPO_ROOT, outPath));
  }

  process.stdout.write(JSON.stringify({
    component: { kebab, pascal, selector, className },
    targetDir: path.relative(REPO_ROOT, targetDir),
    written,
  }, null, 2));
  process.stdout.write('\n');
}

main();
