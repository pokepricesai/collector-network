#!/usr/bin/env node
// Strip em dashes (U+2014) from USER-FACING copy in apps/yugioh/src.
// Preserves em dashes inside single-line (//) and block (/* */) comments
// so internal notes stay readable. Substitutions:
//   `</strong> — X` → `</strong>: X`   (definition-list pattern)
//   `</b> — X`      → `</b>: X`
//   `word — word`   → `word. Word`      (sentence break; capitalises next)
//   `word — word` inside single-line string → `word. Word`
// Idempotent. Writes files in place.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const EXTS = new Set(['.ts', '.tsx', '.css', '.md'])
const SKIP = new Set(['node_modules', '.next', '__tests__'])

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (EXTS.has(extname(name))) acc.push(full)
  }
  return acc
}

function stripCommentsMask(src) {
  // Return a mask string same length as src where each character is
  // ' ' for characters that are code (checkable for em dashes) and
  // '#' for characters inside comments (not checked).
  const mask = new Array(src.length).fill(' ')
  let i = 0
  let inString = null
  let escape = false
  while (i < src.length) {
    const c = src[i]
    if (escape) { escape = false; i++; continue }
    if (inString) {
      if (c === '\\') escape = true
      else if (c === inString) inString = null
      i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; i++; continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { mask[i] = '#'; i++ }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      mask[i] = '#'; mask[i + 1] = '#'; i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        mask[i] = '#'; i++
      }
      if (i < src.length) { mask[i] = '#'; mask[i + 1] = '#'; i += 2 }
      continue
    }
    i++
  }
  return mask.join('')
}

function replaceEmDashes(src) {
  const mask = stripCommentsMask(src)
  const EM = '—'
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src[i] === EM && mask[i] === ' ') {
      // Look at surroundings.
      const before = src.slice(Math.max(0, i - 20), i)
      const after = src.slice(i + 1, Math.min(src.length, i + 40))
      // Definition-list pattern: `</strong> —` or `</b> —` → replace ` — ` with `: `.
      if (/<\/(strong|b|em|i)>\s*$/i.test(before)) {
        // Trim trailing space in `out` if we already emitted, and consume following space.
        // Ensure form: `</strong>: `
        // Backtrack to remove one leading space if present.
        if (out.endsWith(' ')) out = out.slice(0, -1)
        out += ':'
        // Consume the em dash.
        i++
        // Ensure single space after.
        if (i < src.length && src[i] === ' ') { out += ' '; i++ }
        else out += ' '
        continue
      }
      // Standalone em-dash used as a value placeholder (e.g. `'—'`).
      // If it's inside a short quoted string, replace with an en-dash (U+2013)
      // so the visual weight stays but the em-dash rule holds.
      const isStandaloneQuoted =
        (src[i - 1] === "'" || src[i - 1] === '"') &&
        (src[i + 1] === "'" || src[i + 1] === '"')
      if (isStandaloneQuoted) {
        out += '–'  // en dash
        i++
        continue
      }
      // Narrative ` — ` between words: replace with `. ` and capitalise next word.
      // Detect: preceded by non-space char + space, followed by space + letter.
      const prevIsSpaceEm = out.endsWith(' ')
      const nextIsSpace = src[i + 1] === ' '
      const followLetter = src[i + 2] || ''
      if (prevIsSpaceEm && nextIsSpace && /[A-Za-z]/.test(followLetter)) {
        // Replace ` — ` with `. ` and capitalise the following letter.
        if (out.endsWith(' ')) out = out.slice(0, -1) // drop preceding space
        out += '. '
        i += 2 // skip ' ' after em dash
        out += followLetter.toUpperCase()
        i++ // consume the following letter
        continue
      }
      // Fallback: replace with a comma if surrounded by spaces, else en dash.
      if (out.endsWith(' ') && src[i + 1] === ' ') {
        out = out.slice(0, -1)
        out += ', '
        i += 2
        continue
      }
      out += '–'  // en dash fallback
      i++
      continue
    }
    out += src[i]
    i++
  }
  return out
}

let files = walk(ROOT)
let touched = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (!src.includes('—')) continue
  const next = replaceEmDashes(src)
  if (next !== src) {
    writeFileSync(f, next)
    touched++
    const remaining = (next.match(/—/g) || []).length
    const stripped = (stripCommentsMask(next).replace(/[^ ]/g, '')).length
    // Count em dashes that are NOT masked as comments.
    let unmaskedRemaining = 0
    for (let i = 0; i < next.length; i++) {
      if (next[i] === '—' && stripCommentsMask(next)[i] === ' ') unmaskedRemaining++
    }
    console.log(`  ${f.replace(ROOT, '')}  wrote (unmasked remaining: ${unmaskedRemaining})`)
  }
}
console.log(`\nTouched ${touched} file(s).`)
