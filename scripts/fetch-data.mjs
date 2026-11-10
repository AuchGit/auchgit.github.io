#!/usr/bin/env node
// Collects everything the website shows into src/data/generated.json:
//
//   games     the AuchLauncher catalog (one list for launcher and website)
//   tools     site.config.json
//   releases  per project from GitHub: version, date, notes, setup download
//   news      all releases of all projects, newest first
//
// Runs before every build. In GitHub Actions GITHUB_TOKEN lifts the API rate
// limit. If GitHub can't be reached, the previous data file stays, so a build
// never ships an empty site.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'data', 'generated.json')
const ART = path.join(ROOT, 'public', 'art')
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'))
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

const UA = { 'User-Agent': 'auchgit-web' }
const API = { ...UA, Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: url.includes('api.github.com') ? API : UA })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer())
}

const clean = v => String(v || '').trim().replace(/^v/i, '')
const cmp = (a, b) => {
  const x = clean(a).split('.').map(Number)
  const y = clean(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

/** Release notes -> list of short lines ("; " and line breaks both separate). */
function lines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n|;\s+|\n(?=[-*•])/)
    .map(l => l.replace(/^[-*•]\s*/, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(l => l && !/latest\.json/i.test(l) && !/^#+\s*$/.test(l))
}

async function releases(repo) {
  const list = await get(`https://api.github.com/repos/${repo}/releases?per_page=40`)
  return list
    .filter(r => !r.draft && !r.prerelease)
    .map(r => {
      const setup = (r.assets || []).find(a => /-setup\.exe$/i.test(a.name))
      return {
        version: clean(r.tag_name),
        date: r.published_at,
        notes: lines(r.body),
        download: setup ? { url: setup.browser_download_url, size: setup.size, name: setup.name } : null,
      }
    })
    .filter(r => /^\d+\.\d+\.\d+/.test(r.version))
    .sort((a, b) => cmp(b.version, a.version))
}

function previous() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const prev = previous()
  let catalog
  try {
    catalog = await get(cfg.catalog)
  } catch (e) {
    if (prev) {
      console.warn(`[data] Katalog nicht erreichbar (${e.message}) - vorherige Daten bleiben`)
      return
    }
    throw e
  }
  const artBase = cfg.catalog.replace(/games\.json$/, '')
  fs.mkdirSync(ART, { recursive: true })

  const project = async (entry, kind) => {
    let rel = []
    try {
      rel = await releases(entry.repo)
    } catch (e) {
      console.warn(`[data] ${entry.repo}: ${e.message} - vorherige Daten bleiben`)
      const old = kind === 'launcher' ? prev?.launcher : prev?.[kind === 'tool' ? 'tools' : 'games']?.find(p => p.id === entry.id)
      rel = old?.releases || []
    }
    let art = entry.art || null
    if (art && !/^(https?:|\/)/.test(art)) {
      const file = `${entry.id}${path.extname(art) || '.jpg'}`
      try {
        fs.writeFileSync(path.join(ART, file), await get(artBase + art, 'buffer'))
        art = `/art/${file}`
      } catch (e) {
        console.warn(`[data] Bild ${art}: ${e.message}`)
        art = fs.existsSync(path.join(ART, file)) ? `/art/${file}` : null
      }
    }
    return {
      id: entry.id,
      kind,
      name: entry.name,
      tagline: entry.tagline || '',
      description: entry.description || '',
      genres: entry.genres || [],
      accent: entry.accent || '#8f82ff',
      repo: entry.repo,
      web: entry.web || null,
      icon: entry.icon || null,
      art,
      latest: rel[0] || null,
      releases: rel,
    }
  }

  const games = await Promise.all(
    catalog.games.filter(g => !g.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(g => project(g, 'game')),
  )
  const tools = await Promise.all((cfg.tools || []).map(t => project(t, 'tool')))
  const launcher = await project({ id: 'launcher', name: cfg.launcher.name, repo: cfg.launcher.repo, accent: '#8f82ff' }, 'launcher')

  const news = [...games, ...tools, launcher]
    .flatMap(p => p.releases.map(r => ({ project: p.id, kind: p.kind, name: p.name, accent: p.accent, version: r.version, date: r.date, notes: r.notes })))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 60)

  const data = { generatedAt: new Date().toISOString(), games, tools, launcher, news }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
  console.log(`[data] ${games.length} Spiele, ${tools.length} Tools, Launcher ${launcher.latest?.version || '-'}, ${news.length} Neuigkeiten`)
}

main().catch(e => {
  console.error(`[data] FEHLER: ${e.message}`)
  process.exit(previous() ? 0 : 1)
})
