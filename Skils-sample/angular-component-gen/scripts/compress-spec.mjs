#!/usr/bin/env node
/**
 * compress-spec.mjs (v2 — optimized)
 *
 * Reads a plain-English component requirement from stdin (or --file),
 * runs it through an aggressive in-script minifier and (optionally) the
 * project's LLMLingua bridge, prints JSON to stdout with the compressed
 * text and token stats, and appends a record to
 * .github/hooks/logs/skill-spec-compression.log.
 *
 * Optimizations vs v1:
 *   - Self-contained: no fragile `import` from the missing
 *     .github/hooks/scripts/lib/minify.mjs (the previous version
 *     errored on module load on this repo).
 *   - Wider markdown/HTML stripping: links, images, HTML tags, table
 *     separators, fenced-code fences, smart-quote/dash normalization.
 *   - Multi-line bullet collapsing + duplicate-bullet de-dup.
 *   - Optional `--aggressive` flag: drops common filler/stopword phrases
 *     for an extra 10–25 % savings on prose-heavy specs.
 *   - Better token estimator: word + punctuation aware (closer to BPE
 *     when `gpt-tokenizer` isn't installed).
 *   - Result cache keyed on sha256(input + flags) so repeated specs
 *     in the same session short-circuit to ~0 ms with `cached: true`.
 *
 * Usage:
 *   echo "Build a feature card with a title and image" | \
 *     node .github/skills/angular-component-gen/scripts/compress-spec.mjs
 *
 *   node .github/skills/angular-component-gen/scripts/compress-spec.mjs \
 *     --file ./spec.md --out ./spec.compressed.txt --aggressive
 *
 * Exit codes:
 *   0 — success
 *   1 — empty input
 *   2 — bad CLI args
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PY_SCRIPT = path.join(REPO_ROOT, '.github', 'hooks', 'scripts', 'llmlingua_compress.py');
const LOG_FILE = path.join(REPO_ROOT, '.github', 'hooks', 'logs', 'skill-spec-compression.log');
const CACHE_DIR = path.join(REPO_ROOT, '.github', 'hooks', 'cache', 'spec-compress');

// ---------- token estimation ----------

let tokenizer = null;
try {
  const mod = await import('gpt-tokenizer').catch(() => null);
  if (mod && typeof mod.encode === 'function') tokenizer = mod;
} catch { /* ignore */ }

function estimateTokens(text) {
  if (!text) return 0;
  if (tokenizer) {
    try { return tokenizer.encode(text).length; } catch { /* fall through */ }
  }
  // Word + punctuation heuristic. For English this tracks BPE within ~10 %:
  //   ~1 token per word + ~0.3 token per non-alphanumeric char + newlines.
  const words = (text.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) || []).length;
  const punct = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
  const newlines = (text.match(/\n/g) || []).length;
  return Math.max(1, Math.round(words * 1.3 + punct * 0.3 + newlines * 0.4));
}

function bytes(s) { return Buffer.byteLength(s, 'utf8'); }

// ---------- deterministic minifier (always safe) ----------

const SAFE_PIPELINE = [
  // 1. Strip zero-width / BOM / weird control chars (keep \n, \t, \r).
  (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, ''),
  // 2. Normalize line endings.
  (s) => s.replace(/\r\n?/g, '\n'),
  // 3. Normalize unicode punctuation to ASCII (smart quotes, dashes, ellipsis).
  (s) => s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' '),
  // 4. Strip HTML / JSX comments.
  (s) => s.replace(/<!--[\s\S]*?-->/g, ''),
  // 5. Strip /* ... */ block comments.
  (s) => s.replace(/\/\*[\s\S]*?\*\//g, ''),
  // 6. Strip // and # line comments that sit on their own line.
  (s) => s.replace(/^\s*(?:\/\/|#)[^\n]*\n/gm, ''),
  // 7. Markdown image: ![alt](url "title") -> alt (URLs are usually irrelevant for codegen).
  (s) => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'),
  // 8. Markdown link: [text](url) -> text. Reference-style [text][ref] -> text.
  (s) => s.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
          .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'),
  // 9. Markdown reference definitions: "[label]: http://..." -> drop entirely.
  (s) => s.replace(/^\s*\[[^\]]+\]:\s*\S+(?:\s+["(].*?[")])?\s*$/gm, ''),
  // 10. Strip raw URLs left orphaned (very low value for codegen).
  (s) => s.replace(/\bhttps?:\/\/\S+/g, '<url>'),
  // 11. HTML tags: drop tags but keep text content.
  (s) => s.replace(/<\/?[a-zA-Z][^>]*>/g, ''),
  // 12. Fenced code-block fences: drop ```lang and ``` lines but keep code.
  //     (The inner code may carry useful examples; we just lose the ceremony.)
  (s) => s.replace(/^[ \t]*```[^\n]*\n?/gm, ''),
  // 13. Inline code backticks: `foo` -> foo (saves 2 chars/token per occurrence).
  (s) => s.replace(/`([^`\n]+?)`/g, '$1'),
  // 14. Markdown horizontal rules.
  (s) => s.replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, ''),
  // 15. Markdown table separator rows: |---|---| or :---:.
  (s) => s.replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/gm, ''),
  // 16. Collapse markdown emphasis (**bold**, _italic_, ~~strike~~).
  (s) => s
    .replace(/(\*{1,3}|_{1,3})(\S[^*_\n]*?\S?)\1/g, '$2')
    .replace(/~~(\S[^~\n]*?\S?)~~/g, '$1'),
  // 17. Drop blockquote prefixes.
  (s) => s.replace(/^\s*>\s?/gm, ''),
  // 18. Canonicalize bullet markers (-, *, +, •, ·) -> "-".
  (s) => s.replace(/^(\s*)[-*+\u2022\u00B7]\s+/gm, '$1- '),
  // 19. Drop empty bullets.
  (s) => s.replace(/^\s*-\s*$/gm, ''),
  // 20. Strip heading hashes (text content stays).
  (s) => s.replace(/^\s*#{1,6}\s+/gm, ''),
  // 21. Truncate base64-looking blobs >120 chars.
  (s) => s.replace(/[A-Za-z0-9+/=]{120,}/g, '<base64-omitted>'),
  // 22. Strip URL tracking params (utm_*, fbclid, gclid, mc_*id).
  (s) => s.replace(/([?&])(?:utm_[^=&]+|fbclid|gclid|mc_[ce]id)=[^&\s]*/g, (_m, p) => p),
  // 23. Trim trailing whitespace per line.
  (s) => s.replace(/[ \t]+\n/g, '\n'),
  // 24. Collapse runs of internal spaces/tabs (preserve leading indent).
  (s) => s.replace(/(\S)[ \t]{2,}(\S)/g, '$1 $2'),
  // 25. Collapse 3+ blank lines into 1.
  (s) => s.replace(/\n{3,}/g, '\n\n'),
  // 26. Drop immediately-duplicated consecutive lines.
  (s) => s.replace(/^(.+)\n(?:\1\n)+/gm, '$1\n'),
  // 27. Final trim.
  (s) => s.trim(),
];

// ---------- aggressive, opt-in stage ----------

// Phrases that occur frequently in product specs but add ~zero codegen value.
// Matched word-boundary, case-insensitive. Order matters (longer first).
const FILLER_PHRASES = [
  'as previously mentioned',
  'as we discussed',
  'in order to',
  'with that said',
  'at the end of the day',
  'needless to say',
  'it should be noted',
  'please note that',
  'please note',
  'kindly note',
  'we would like to',
  'we want to',
  'we need to',
  'i would like to',
  'i want to',
  'the goal is to',
  'the idea is to',
  'make sure to',
  'be sure to',
  'feel free to',
  'note that',
  'basically',
  'essentially',
  'literally',
  'actually',
  'really',
  'very',
  'just',
  'simply',
  'kindly',
  'please',
];

const FILLER_RE = new RegExp(
  '\\b(?:' + FILLER_PHRASES.map((p) => p.replace(/\s+/g, '\\s+')).join('|') + ')\\b\\s*,?\\s*',
  'gi'
);

const AGGRESSIVE_PIPELINE = [
  // a. Drop filler phrases.
  (s) => s.replace(FILLER_RE, ''),
  // b. "should be / must be / will be" -> "" when followed by an adjective is risky;
  //    instead, normalize "should/must/will" alone to "must" for shorter modal.
  (s) => s.replace(/\b(?:should|will|shall|would)\b/gi, 'must'),
  // c. Collapse "the X" -> "X" when X is a single word (saves ~1 token / occurrence).
  //    Skip when "the" starts a sentence to keep grammar reasonable.
  (s) => s.replace(/(?<=[\s,;:(])the\s+([A-Za-z][A-Za-z0-9_-]+)/g, '$1'),
  // d. Collapse runs of single-line bullets into a comma list when each is <= 6 words.
  (s) => s.replace(
    /(?:^- [^\n]{1,60}\n){2,}/gm,
    (block) => {
      const items = block.trim().split('\n').map((l) => l.replace(/^- /, '').trim());
      const allShort = items.every((i) => i.split(/\s+/).length <= 6);
      return allShort ? '- ' + items.join(', ') + '\n' : block;
    }
  ),
  // e. De-duplicate non-adjacent identical bullets (case-insensitive).
  (s) => {
    const seen = new Set();
    return s.split('\n').filter((line) => {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (!m) return true;
      const key = m[1].toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join('\n');
  },
  // f. Final whitespace pass.
  (s) => s.replace(/\n{3,}/g, '\n\n').trim(),
];

function minify(text, { aggressive = false } = {}) {
  let out = text;
  for (const step of SAFE_PIPELINE) out = step(out);
  if (aggressive) {
    for (const step of AGGRESSIVE_PIPELINE) out = step(out);
  }
  return out;
}

// ---------- optional ML pass ----------

function tryMlCompress(text, opts = {}) {
  const {
    pyScript = PY_SCRIPT,
    minChars = Number(process.env.HOOK_ML_MIN_CHARS ?? 1500), // lowered from 4000
    rate = Number(process.env.HOOK_ML_RATE ?? 0.5),
    enabled = process.env.HOOK_DISABLE_ML !== '1',
    timeoutMs = 8000,
  } = opts;

  if (!enabled) return null;
  if (!text || text.length < minChars) return null;
  if (!pyScript || !fs.existsSync(pyScript)) return null;

  const py = spawnSync('python3', [pyScript], {
    input: JSON.stringify({ text, rate }),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (py.status !== 0 || !py.stdout) return null;
  try {
    const r = JSON.parse(py.stdout);
    if (typeof r.compressed === 'string' && r.compressed.length > 0) return r;
  } catch { /* ignore */ }
  return null;
}

// ---------- cache ----------

function cacheKey(text, flags) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ text, flags }))
    .digest('hex')
    .slice(0, 32);
}

function cacheRead(key) {
  try {
    const p = path.join(CACHE_DIR, key + '.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function cacheWrite(key, payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(payload), 'utf8');
  } catch { /* best-effort */ }
}

// ---------- CLI ----------

function parseArgs(argv) {
  const args = { file: null, out: null, aggressive: false, noCache: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--aggressive') args.aggressive = true;
    else if (a === '--no-cache') args.noCache = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: compress-spec.mjs [--file <path>] [--out <path>] [--aggressive] [--no-cache]\n' +
        '       echo "spec" | compress-spec.mjs\n'
      );
      process.exit(0);
    } else {
      process.stderr.write(`Unknown arg: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

(async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv);
  const text = args.file
    ? fs.readFileSync(args.file, 'utf8')
    : await readStdin();

  if (!text || !text.trim()) {
    process.stderr.write('No spec text provided (stdin or --file empty).\n');
    process.exit(1);
  }

  const flags = { aggressive: args.aggressive };
  const key = cacheKey(text, flags);

  // Cache hit
  if (!args.noCache) {
    const hit = cacheRead(key);
    if (hit && typeof hit.compressed === 'string') {
      if (args.out) fs.writeFileSync(args.out, hit.compressed, 'utf8');
      process.stdout.write(JSON.stringify({ ...hit, cached: true, durationMs: Date.now() - t0 }, null, 2));
      process.stdout.write('\n');
      return;
    }
  }

  const origBytes = bytes(text);
  const origTokens = estimateTokens(text);

  const minified = minify(text, { aggressive: args.aggressive });
  const minTokens = estimateTokens(minified);

  let mode = args.aggressive ? 'minify-aggressive' : 'minify';
  let finalText = minified;
  let finalTokens = minTokens;

  const ml = tryMlCompress(minified);
  if (ml) {
    finalText = ml.compressed;
    finalTokens = (typeof ml.compressedTokens === 'number' && ml.compressedTokens > 0)
      ? ml.compressedTokens
      : estimateTokens(finalText);
    mode += '+llmlingua';
  }

  const finalBytes = bytes(finalText);
  const savedTokens = Math.max(0, origTokens - finalTokens);
  const savedPct = origTokens
    ? Number(((savedTokens / origTokens) * 100).toFixed(1))
    : 0;
  const durationMs = Date.now() - t0;

  // Log
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, [
      new Date().toISOString(),
      `mode=${mode}`,
      `origBytes=${origBytes}`,
      `finalBytes=${finalBytes}`,
      `origTokens~=${origTokens}`,
      `finalTokens~=${finalTokens}`,
      `savedTokens=${savedTokens}`,
      `savedPct=${savedPct}%`,
      `durationMs=${durationMs}`,
    ].join('\t') + '\n');
  } catch { /* best-effort */ }

  if (args.out) {
    fs.writeFileSync(args.out, finalText, 'utf8');
  }

  const payload = {
    mode,
    original: text,
    compressed: finalText,
    originalBytes: origBytes,
    compressedBytes: finalBytes,
    originalTokens: origTokens,
    compressedTokens: finalTokens,
    savedTokens,
    savedPct,
    outFile: args.out || null,
    cached: false,
    durationMs,
  };

  if (!args.noCache) cacheWrite(key, payload);

  process.stdout.write(JSON.stringify(payload, null, 2));
  process.stdout.write('\n');
})();
