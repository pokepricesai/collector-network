// Remove em-dashes from site-authored public copy in apps/lorcana/src.
// Rules:
//   * skip single-line `//` comments and multi-line `/* ... */` comments
//     (including JSX `{/* ... */}` wrappers) — those are not public copy
//   * skip blocks entirely inside `/* ... */` by tracking a simple flag
//   * replace a space-flanked em-dash with `. ` when the next word starts
//     with an uppercase letter (treats the em-dash as a sentence break);
//     otherwise replace with `, ` so appositives read naturally
//   * replace a standalone `'—'` or `"—"` placeholder with a plain
//     hyphen `-`, since those are typically dash-char fallbacks for
//     missing data (e.g. `collector_number ?? '—'`)
//   * never touch imported/third-party content, DB values, card data,
//     code syntax — those don't contain em-dashes in a .tsx/.ts source

import fs from 'fs/promises';
import path from 'path';

const EM = '—';
const ROOT = path.resolve('apps/lorcana/src');

async function walk(dir) {
  const out = [];
  for (const name of await fs.readdir(dir)) {
    const p = path.join(dir, name);
    const stat = await fs.stat(p);
    if (stat.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(tsx?|md|css)$/.test(name)) out.push(p);
  }
  return out;
}

function processFile(src) {
  const lines = src.split('\n');
  let inBlockComment = false;
  let changed = 0;
  const out = lines.map((line) => {
    const trimmed = line.trimStart();
    if (inBlockComment) {
      // Preserve block-comment content verbatim
      if (/\*\/\s*$/.test(trimmed) || /\*\//.test(line)) {
        if (!/\/\*/.test(trimmed) || /\/\*.*\*\//.test(line)) {
          inBlockComment = false;
        }
      }
      return line;
    }
    // Entire-line block comment start
    if (/^\/\*/.test(trimmed) && !/\*\//.test(trimmed)) {
      inBlockComment = true;
      return line;
    }
    // JSX inline comment `{/* ... */}` on its own line
    if (/^\{\s*\/\*/.test(trimmed) && !/\*\/\s*\}/.test(trimmed)) {
      inBlockComment = true;
      return line;
    }
    // Line that's purely a `//` comment — preserve
    if (/^\s*\/\//.test(line)) return line;
    // Line that starts with ` * ` or ` */` (JSDoc / block comment body)
    if (/^\s*\*/.test(line)) return line;

    if (!line.includes(EM)) return line;

    // Replace `'—'` and `"—"` placeholder strings with plain hyphen
    let result = line
      .replace(new RegExp(`'${EM}'`, 'g'), () => { changed += 1; return "'-'"; })
      .replace(new RegExp(`"${EM}"`, 'g'), () => { changed += 1; return '"-"'; });

    // Replace ` — ` (space-flanked em-dash) with `. ` or `, ` by context
    result = result.replace(
      new RegExp(`\\s${EM}\\s([A-Za-z])`, 'g'),
      (_, nextChar) => {
        changed += 1;
        return (/[A-Z]/.test(nextChar)) ? `. ${nextChar}` : `, ${nextChar}`;
      },
    );

    // Any remaining em-dashes: comma fallback
    result = result.replace(new RegExp(EM, 'g'), () => { changed += 1; return ','; });

    return result;
  });
  return { out: out.join('\n'), changed };
}

const files = await walk(ROOT);
let totalChanged = 0;
let touchedFiles = 0;
for (const f of files) {
  const src = await fs.readFile(f, 'utf8');
  if (!src.includes(EM)) continue;
  const { out, changed } = processFile(src);
  if (changed === 0) continue;
  await fs.writeFile(f, out, 'utf8');
  touchedFiles += 1;
  totalChanged += changed;
  console.log(`  ${f.replace(/\\/g, '/').replace(/^.*apps\/lorcana\//, 'apps/lorcana/')}: ${changed}`);
}
console.log(`\nTOTAL ${totalChanged} occurrences across ${touchedFiles} files`);
