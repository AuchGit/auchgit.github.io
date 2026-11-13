#!/usr/bin/env node
// Builds everything the website and the apps read, before every site build.
//
// Sources
//   catalog/games.json      the games (one list for website and launcher)
//   site.config.json        tools, launcher, texts
//   releases of this repo   the public download channel: every installer is a
//                           release here, tagged <project-id>-v<version>
//   releases of code repos  only while those repos are still public (transition)
//
// Output
//   src/data/generated.json             data for the pages
//   public/api/catalog.json             catalog for AuchLauncher
//   public/api/<id>/latest.json         update feed (Tauri updater format)
//   public/api/<id>/releases.json       version history for the launcher
//   public/art/*                        cover art
//
// In GitHub Actions GITHUB_TOKEN lifts the API rate limit. If GitHub can't be
// reached the build fails rather than shipping empty feeds; Pages then keeps
// serving the previous version.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'data', 'generated.json')
const PUBLIC = path.join(ROOT, 'public')
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'))
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'games.json'), 'utf8'))
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const DIST = cfg.dist

const UA = { 'User-Agent': 'auchgit-web' }
const API = { ...UA, Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: url.includes('api.github.com') ? API : UA })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}`)
    err.status = res.status
    throw err
  }
  return as === 'json' ? res.json() : as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer())
}

const clean = v => String(v || '').trim().replace(/^v/i, '')
const cmp = (a, b) => {
  const x = clean(a).split('.').map(Number)
  const y = clean(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

/** Release notes -> short lines ("; " and line breaks both separate). */
function lines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n|;\s+|\n(?=[-*•])/)
    .map(l => l.replace(/^[-*•]\s*/, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(l => l && !/latest\.json/i.test(l) && !/^#+\s*$/.test(l))
}

function toRelease(r, version, source) {
  const assets = r.assets || []
  const setup = assets.find(a => /-setup\.exe$/i.test(a.name))
  const feed = assets.find(a => a.name === 'latest.json')
  return {
    version,
    date: r.published_at,
    notes: lines(r.body),
    download: setup ? { url: setup.browser_download_url, size: setup.size, name: setup.name } : null,
    feed: feed ? feed.browser_download_url : null,
    source,
  }
}

async function listReleases(repo) {
  const all = []
  for (let page = 1; page <= 5; page++) {
    const batch = await get(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`)
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all.filter(r => !r.draft && !r.prerelease)
}

/** Releases of the download channel, grouped by project id (tag "<id>-v1.2.3"). */
async function distReleases() {
  const groups = {}
  for (const r of await listReleases(DIST)) {
    const m = /^(.+)-v(\d+\.\d+\.\d+)$/.exec(r.tag_name || '')
    if (!m) continue
    ;(groups[m[1]] ||= []).push(toRelease(r, m[2], 'dist'))
  }
  return groups
}

/** Releases still living in a (public) code repo. Empty once it is private. */
async function legacyReleases(repo) {
  try {
    return (await listReleases(repo))
      .map(r => toRelease(r, clean(r.tag_name), 'legacy'))
      .filter(r => /^\d+\.\d+\.\d+$/.test(r.version))
  } catch (e) {
    if (e.status === 404) return [] // private or gone: expected after the move
    throw e
  }
}

function writeJson(rel, data) {
  const file = path.join(PUBLIC, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

async function main() {
  const dist = await distReleases()
  fs.rmSync(path.join(PUBLIC, 'api'), { recursive: true, force: true })
  fs.mkdirSync(path.join(PUBLIC, 'art'), { recursive: true })

  const project = async (entry, kind) => {
    // Download channel first; the old code repo only fills versions it doesn't have.
    const own = dist[entry.id] || []
    const legacy = entry.repo ? await legacyReleases(entry.repo) : []
    const byVersion = new Map()
    for (const r of [...legacy, ...own]) byVersion.set(r.version, r)
    const releases = [...byVersion.values()].sort((a, b) => cmp(b.version, a.version))

    // Update feed: latest.json of the newest release that has one, served from
    // our own domain. A release still uploading its files is skipped, so the
    // feed never goes missing or backwards.
    const newest = releases[0]
    if (newest) {
      let feedJson = null
      for (const r of releases) {
        try {
          if (r.feed) feedJson = await get(r.feed)
          else if (r.source === 'legacy' && r === newest) feedJson = await get(`https://github.com/${entry.repo}/releases/latest/download/latest.json`)
        } catch (e) {
          console.warn(`[data] ${entry.id} ${r.version}: latest.json nicht lesbar (${e.message})`)
        }
        if (feedJson) break
      }
      if (feedJson) writeJson(`api/${entry.id}/latest.json`, feedJson)
      writeJson(`api/${entry.id}/releases.json`, {
        releases: releases.map(r => ({ version: r.version, date: r.date, notes: r.notes, size: r.download?.size ?? null, url: r.download?.url ?? null })),
      })
    }

    // Cover art from the catalog folder.
    let art = entry.art || null
    if (art && !/^(https?:|\/)/.test(art)) {
      const src = path.join(ROOT, 'catalog', art)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(PUBLIC, 'art', path.basename(art)))
        art = `/art/${path.basename(art)}`
      } else art = null
    }

    return {
      id: entry.id,
      kind,
      name: entry.name,
      tagline: entry.tagline || '',
      description: entry.description || '',
      genres: entry.genres || [],
      accent: entry.accent || '#8f82ff',
      repo: entry.repo || null,
      web: entry.web || null,
      icon: entry.icon || null,
      art,
      latest: newest || null,
      releases,
    }
  }

  const games = await Promise.all(
    catalog.games.filter(g => !g.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(g => project(g, 'game')),
  )
  const tools = await Promise.all((cfg.tools || []).map(t => project(t, 'tool')))
  const launcher = await project({ id: 'launcher', name: cfg.launcher.name, repo: cfg.launcher.repo, accent: '#8f82ff' }, 'launcher')

  // The launcher's catalog: same file, served from here, plus the tools the
  // launcher can install and start (those with a "launcher" block in site.config.json).
  const launcherTools = (cfg.tools || []).filter(t => t.launcher).map(t => ({
    id: t.id, kind: 'tool', name: t.name, tagline: t.tagline || '', description: t.description || '',
    genres: t.genres || [], accent: t.accent || '#8f82ff', repo: t.repo || null, web: t.web || null,
    icon: t.icon ? t.icon.replace(/^\//, '') : null, ...t.launcher,
  }))
  writeJson('api/catalog.json', { ...catalog, tools: launcherTools })

  const news = [...games, ...tools, launcher]
    .flatMap(p => p.releases.map(r => ({ project: p.id, kind: p.kind, name: p.name, accent: p.accent, version: r.version, date: r.date, notes: r.notes })))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 60)

  const data = { generatedAt: new Date().toISOString(), games, tools, launcher, news }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
  const srcs = p => `${p.id} ${p.latest?.version || '-'}${p.latest ? ` (${p.latest.source})` : ''}`
  console.log(`[data] ${[...games, ...tools, launcher].map(srcs).join(', ')}`)
}

main().catch(e => {
  console.error(`[data] FEHLER: ${e.message}`)
  process.exit(1)
})
