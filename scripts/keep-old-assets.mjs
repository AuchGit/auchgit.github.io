#!/usr/bin/env node
// Keeps the previous version's scripts alive for one more deploy.
//
// GitHub Pages lets browsers cache pages for 10 minutes. A page cached just
// before a deploy still points at the old /_astro/*.js files, which a plain
// deploy deletes, and its interactive parts (login, account, feedback) then
// stay empty. Before uploading, this copies every asset the live site still
// references into the new dist/ (only files that are missing), following JS
// imports, so cached pages keep working until they expire.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const SITE = 'https://auchgit.github.io'

function pages(dir, base = '') {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '_astro' || e.name === 'api' || e.name === 'art') continue
    if (e.isDirectory()) out.push(...pages(path.join(dir, e.name), `${base}/${e.name}`))
    else if (e.name === 'index.html') out.push(`${base}/`)
  }
  return out
}

async function get(url, as = 'text') {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'auchgit-web' } })
    if (!res.ok) return null
    return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

const assetRe = /\/_astro\/[A-Za-z0-9_.@-]+\.(?:js|css|woff2?|svg|png|jpg|webp)/g
const relRe = /["'](\.\/[A-Za-z0-9_.@-]+\.js)["']/g

const queue = new Set()
for (const page of pages(DIST)) {
  const html = await get(SITE + page)
  for (const m of html?.match(assetRe) || []) queue.add(m)
}

let kept = 0
const seen = new Set()
while (queue.size) {
  const [asset] = queue
  queue.delete(asset)
  if (seen.has(asset)) continue
  seen.add(asset)
  const target = path.join(DIST, asset)
  const isJs = asset.endsWith('.js')
  let body = fs.existsSync(target) ? (isJs ? fs.readFileSync(target, 'utf8') : null) : null
  if (body === null && !fs.existsSync(target)) {
    const fetched = await get(SITE + asset, isJs ? 'text' : 'buffer')
    if (fetched == null) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, fetched)
    kept++
    body = isJs ? fetched : null
  }
  if (isJs && body) {
    for (const m of body.match(assetRe) || []) queue.add(m)
    for (const m of body.matchAll(relRe)) queue.add('/_astro/' + m[1].slice(2))
  }
}
console.log(`[assets] ${kept} Datei(en) der vorigen Version behalten (${seen.size} geprüft)`)
