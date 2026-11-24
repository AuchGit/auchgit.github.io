// Character planner (WoW Forever): gear per slot, talents, a link that holds it all.
// Items come from Wowhead's tooltip service (nether.wowhead.com, the one their item tooltips
// on other sites use: name, quality, icon, tooltip) and are kept on this device for a week;
// once our own item data (Blizzard, lib/wowItems.js) is there, the search finds them too.
//
// A character as a link: https://auchgit.github.io/wow/?c=<class>&t=<talent code>&g=<items>&n=<name>
// g = item ids in SLOTS order, '.' between, empty for nothing ("19019..2244").
// The website has a copy of this file (scripts/sync-web-toolbox.py).
import { SITE } from './wowTalents'

export const SLOTS = [
  { id: 'head', name: 'Kopf' }, { id: 'neck', name: 'Hals' }, { id: 'shoulder', name: 'Schultern' },
  { id: 'back', name: 'Rücken' }, { id: 'chest', name: 'Brust' }, { id: 'wrist', name: 'Handgelenke' },
  { id: 'hands', name: 'Hände' }, { id: 'waist', name: 'Taille' }, { id: 'legs', name: 'Beine' },
  { id: 'feet', name: 'Füße' }, { id: 'finger1', name: 'Finger' }, { id: 'finger2', name: 'Finger' },
  { id: 'trinket1', name: 'Schmuck' }, { id: 'trinket2', name: 'Schmuck' },
  { id: 'main', name: 'Waffenhand' }, { id: 'off', name: 'Schildhand' }, { id: 'ranged', name: 'Distanz' },
]
// the slot word in a German or English tooltip -> where it goes (first free of the pair)
const SLOT_WORDS = [
  [/^(kopf|head)$/i, ['head']], [/^(hals|neck)$/i, ['neck']], [/^(schulter|schultern|shoulder)$/i, ['shoulder']],
  [/^(rücken|back)$/i, ['back']], [/^(brust|robe|chest)$/i, ['chest']], [/^(handgelenke?|wrist)$/i, ['wrist']],
  [/^(hände|hands)$/i, ['hands']], [/^(taille|waist)$/i, ['waist']], [/^(beine|legs)$/i, ['legs']],
  [/^(füße|feet)$/i, ['feet']], [/^(finger)$/i, ['finger1', 'finger2']], [/^(schmuck|trinket)$/i, ['trinket1', 'trinket2']],
  [/^(einhändig|one-hand)$/i, ['main', 'off']], [/^(waffenhand|main hand|zweihändig|two-hand)$/i, ['main']],
  [/^(schildhand|in schildhand geführt|nebenhand|off hand|held in off-hand)$/i, ['off']],
  [/^(distanz|distanzwaffe|wurfwaffe|relikt|ranged|thrown|relic)$/i, ['ranged']],
]

export const emptyChar = (cls = 'warrior') => ({ cls, talents: '', gear: {}, name: '' })

export function charUrl(ch) {
  const g = SLOTS.map(s => ch.gear?.[s.id] || '').join('.').replace(/\.+$/, '')
  const p = new URLSearchParams()
  p.set('c', ch.cls)
  if (ch.talents) p.set('t', ch.talents.replace(/^[a-z]+\//, ''))
  if (g) p.set('g', g)
  if (ch.name?.trim()) p.set('n', ch.name.trim().slice(0, 80))
  return `${SITE}/wow/?${p.toString().replace(/%2F/g, '/')}`
}
/** A character from one of our links (null if it isn't one). */
export function charFrom(url) {
  try {
    const u = new URL(url)
    const cls = u.searchParams.get('c')
    if (!cls || !/^[a-z]+$/.test(cls)) return null
    const ids = (u.searchParams.get('g') || '').split('.')
    const gear = {}
    SLOTS.forEach((s, i) => { const n = Number(ids[i]); if (n > 0) gear[s.id] = n })
    const t = u.searchParams.get('t')
    return { cls, talents: t != null ? `${cls}/${t}` : '', gear, name: (u.searchParams.get('n') || '').slice(0, 80) }
  } catch { return null }
}

// ------------------------------------------------------------------ items (Wowhead's tooltip service)
const KEY = 'auch.wowTip.'
const WEEK = 7 * 864e5
const cached = (id, loc) => { try { const v = JSON.parse(localStorage.getItem(KEY + loc + '.' + id)); return v && Date.now() - v.at < WEEK ? v.item : null } catch { return null } }
const keep = (id, loc, item) => { try { localStorage.setItem(KEY + loc + '.' + id, JSON.stringify({ at: Date.now(), item })) } catch { /* full */ } }
const asking = new Map()
const QUALITY = ['POOR', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT', 'HEIRLOOM']

/** { id, name, quality ('EPIC' …), icon (name), slot (the tooltip's word), lines, stats {name: sum}, effects [text] } */
export function tipNow(id, lang = 'de') { return cached(id, lang) }
export function itemTip(id, lang = 'de') {
  const hit = cached(id, lang)
  if (hit) return Promise.resolve(hit)
  const k = lang + id
  if (!asking.has(k)) {
    asking.set(k, (async () => {
      const r = await fetch(`https://nether.wowhead.com/forever/tooltip/item/${id}?locale=${lang === 'de' ? 3 : 0}`)
      if (!r.ok) throw new Error('Das Item gibt es nicht (oder Wowhead antwortet nicht).')
      const j = await r.json()
      if (!j?.name) throw new Error('Das Item gibt es nicht.')
      const item = { id, name: j.name, quality: QUALITY[j.quality] || 'COMMON', icon: j.icon || null, ...readTooltip(j.tooltip || '') }
      keep(id, lang, item)
      return item
    })().finally(() => setTimeout(() => asking.delete(k), 1000)))
  }
  return asking.get(k)
}

/**
 * The tooltip's HTML as our lines ({ t, r?, c? } like lib/wowItems.js), its slot word, the
 * "+5 Beweglichkeit" stats and the green "Anlegen:" / "Equip:" effects. Read with DOMParser:
 * nothing of it runs or ends up as HTML on our side.
 */
export function readTooltip(html) {
  const out = { lines: [], slot: null, stats: {}, effects: [] }
  if (typeof DOMParser === 'undefined' || !html) return out
  const doc = new DOMParser().parseFromString(`<div>${html.replace(/<br\s*\/?>/gi, '\n')}</div>`, 'text/html')
  const colorOf = el => {
    const c = el.closest?.('[class]')?.className || ''
    return /\bq2\b/.test(c) ? 'green' : /\bq\b/.test(c) ? 'gold' : /\bq0\b/.test(c) ? 'grey' : undefined
  }
  // A line runs to the next break (<br>) or table row; links and spans inside it belong to it
  // (the green "Trefferchance: <a>…</a>" is one line). Its color: the first colored part.
  let cur = null
  const flush = () => {
    const t = cur?.t.replace(/\s+/g, ' ').trim()
    if (t) out.lines.push({ t, ...(cur.c ? { c: cur.c } : {}) })
    cur = null
  }
  const walk = node => {
    for (const el of node.childNodes) {
      if (el.nodeType === 3) {
        const parts = el.textContent.split('\n')
        parts.forEach((part, i) => {
          if (i > 0) flush()
          if (!part.trim() && !cur) return
          cur ||= { t: '', c: colorOf(el.parentElement) }
          cur.c ||= colorOf(el.parentElement)
          cur.t += part
        })
      } else if (el.nodeName === 'TR') {
        flush()
        const td = el.querySelector(':scope > td')?.textContent.replace(/\s+/g, ' ').trim()
        const th = el.querySelector(':scope > th')?.textContent.replace(/\s+/g, ' ').trim()
        if (td && th !== undefined && !el.querySelector(':scope > td table')) {
          out.lines.push({ t: td, ...(th ? { r: th } : {}) })
          if (!out.slot && SLOT_WORDS.some(([re]) => re.test(td))) out.slot = td
        } else walk(el)
        flush()
      } else if (el.nodeType === 1) {
        if (/^(TABLE|TBODY|DIV)$/.test(el.nodeName)) flush()
        walk(el)
        if (/^(TABLE|TBODY|DIV)$/.test(el.nodeName)) flush()
      }
    }
  }
  walk(doc.body.firstChild)
  flush()
  // the item's own name is shown apart
  if (out.lines[0] && !out.lines[0].r) out.lines.shift()
  for (const l of out.lines) {
    const m = l.t.match(/^\+(\d+) (.+)$/)
    if (m && !l.c) out.stats[m[2]] = (out.stats[m[2]] || 0) + Number(m[1])
    if (l.c === 'green' && /^(Anlegen|Equip|Benutzen|Use|Trefferchance|Chance on hit):/i.test(l.t)) out.effects.push(l.t)
  }
  return out
}

/** The slots an item fits ([] if none). */
export const slotsFor = item => SLOT_WORDS.find(([re]) => re.test(item?.slot || ''))?.[1] || []
/** Where an item goes in this character (the free one of a pair first), or null. */
export function slotFor(item, gear = {}) {
  const fits = slotsFor(item)
  return fits.find(s => !gear[s]) || fits[0] || null
}

/** Everything the gear adds up to: { stats: [[name, sum]] biggest first, effects: [[text, times]] }. */
export function totals(items) {
  const stats = {}
  const effects = {}
  for (const it of items) {
    if (!it) continue
    for (const [k, v] of Object.entries(it.stats || {})) stats[k] = (stats[k] || 0) + v
    for (const e of it.effects || []) effects[e] = (effects[e] || 0) + 1
  }
  return { stats: Object.entries(stats).sort((a, b) => b[1] - a[1]), effects: Object.entries(effects) }
}
