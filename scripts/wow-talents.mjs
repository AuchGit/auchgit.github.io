// WoW Forever talents for the toolbox's own talent calculator, from talentsforever.com
// (CC BY 4.0: free to use with a link to the site; game names, icons and texts are
// Blizzard's). Trimmed to what the calculator shows, German class and tree names added.
//
//   node scripts/wow-talents.mjs     -> src/data/wow-forever-talents.json (bundled fallback)
//
// The website mirrors the same on every build (AuchWeb scripts/fetch-data.mjs ->
// /api/wow-forever/talents.json, hourly), so hotfixes reach the launcher without an update.
// AuchWeb has a copy of this file (scripts/sync-web-toolbox.py).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SOURCE = 'https://talentsforever.com/data.json'

const CLASS_DE = { warrior: 'Krieger', paladin: 'Paladin', hunter: 'Jäger', rogue: 'Schurke', priest: 'Priester', shaman: 'Schamane', mage: 'Magier', warlock: 'Hexenmeister', druid: 'Druide' }
const TREE_DE = {
  Arms: 'Waffen', Fury: 'Furor', Protection: 'Schutz', Holy: 'Heilig', Retribution: 'Vergeltung',
  'Beast Mastery': 'Tierherrschaft', Marksmanship: 'Treffsicherheit', Survival: 'Überleben',
  Assassination: 'Meucheln', Combat: 'Kampf', Subtlety: 'Täuschung', Discipline: 'Disziplin', Shadow: 'Schatten',
  Elemental: 'Elementar', Enhancement: 'Verstärkung', Restoration: 'Wiederherstellung',
  Arcane: 'Arkan', Fire: 'Feuer', Frost: 'Frost', Affliction: 'Gebrechen', Demonology: 'Dämonologie', Destruction: 'Zerstörung',
  Balance: 'Gleichgewicht', 'Feral Combat': 'Wilder Kampf', Feral: 'Wilder Kampf',
}

/**
 * { generated, license, attribution, link, points, classes: { warrior: { name, en, icon, trees:
 * [{ name, en, icon, talents: [{ n, m, r, c, i, d: [rank texts], q?: required talent's name,
 * k?: cost line, a?: 1 = active ability }] }] } } }. Talents in grid order (row, column): the
 * order of the digits in a build code.
 */
export function trim(d) {
  const classes = {}
  for (const [en, c] of Object.entries(d.talents || {})) {
    const id = en.toLowerCase()
    classes[id] = {
      name: CLASS_DE[id] || en,
      en,
      icon: c.icon,
      trees: (c.trees || []).map(t => ({
        name: TREE_DE[t.name] || t.name,
        en: t.name,
        icon: t.icon,
        talents: [...(t.talents || [])].sort((a, b) => a.row - b.row || a.col - b.col).map(x => ({
          n: x.name,
          m: x.max,
          r: x.row,
          c: x.col,
          i: x.icon,
          d: x.desc || [],
          ...(x.req ? { q: x.req } : {}),
          ...(x.cost ? { k: x.cost } : {}),
          ...(x.passive === false ? { a: 1 } : {}),
        })),
      })),
    }
  }
  return { generated: d.generated, license: d.license || 'CC-BY-4.0', attribution: d.attribution || 'Data from talentsforever.com', link: 'https://talentsforever.com', points: 51, classes }
}

export async function download() {
  const r = await fetch(SOURCE, { headers: { 'user-agent': 'AuchGit toolbox (talent calculator)' } })
  if (!r.ok) throw new Error(`talentsforever: ${r.status}`)
  return trim(await r.json())
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'wow-forever-talents.json')
  const data = await download()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(data) + '\n')
  const n = Object.values(data.classes).reduce((a, c) => a + c.trees.reduce((b, t) => b + t.talents.length, 0), 0)
  console.log(`${Object.keys(data.classes).length} classes, ${n} talents, data of ${data.generated} -> ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
}
