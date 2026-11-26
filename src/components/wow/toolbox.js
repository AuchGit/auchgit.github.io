// Toolboxes for games that aren't ours: the good web tools for them (talent calculator, item
// database, maps …) in one place, in the launcher and in the overlay over the game, plus your
// own saved builds, items and pages (store/useToolbox.js). First one: WoW Forever, with
// Wowhead's pages for it (German under /forever/de/…).
import { BookOpen, Database, Gamepad2, Map as MapIcon, Newspaper, Scroll, Shield, Sparkles, Swords } from 'lucide-react'
import { buildNameIn, buildText } from './wowTalents'
import { charFrom } from './wowGear'

const WH = 'https://www.wowhead.com/forever'

/** The nine classes of WoW Forever: German name and the usual class color. */
export const CLASSES = {
  warrior: { name: 'Krieger', color: '#C69B6D' },
  paladin: { name: 'Paladin', color: '#F48CBA' },
  hunter: { name: 'Jäger', color: '#AAD372' },
  rogue: { name: 'Schurke', color: '#FFF468' },
  priest: { name: 'Priester', color: '#E8E8E8' },
  shaman: { name: 'Schamane', color: '#2D8CF0' },
  mage: { name: 'Magier', color: '#3FC7EB' },
  warlock: { name: 'Hexenmeister', color: '#8788EE' },
  druid: { name: 'Druide', color: '#FF7C0A' },
}

export const BOXES = [{
  id: 'wow-forever',
  name: 'WoW Forever',
  site: 'Wowhead',
  tools: [
    // own (in our look: components/toolbox/Talents.jsx, Items.jsx); url = Wowhead's, for "there instead"
    { id: 'talents', name: 'Talente', own: 'talents', url: `${WH}/talent-calc`, Icon: Sparkles, match: /^\/talent-calc/ },
    { id: 'items', name: 'Items', own: 'items', url: `${WH}/items`, Icon: Swords, match: /^\/(items|item=)/ },
    { id: 'gear', name: 'Planer', own: 'gear', url: `${WH}/items`, Icon: Shield, match: /^$/ },
    // what the AuchAddOn brought from the game (desktop app: components/toolbox/Game.jsx)
    { id: 'game', name: 'Charaktere', own: 'game', desktop: true, url: `${WH}/quests`, Icon: Gamepad2, match: /(?!)/ },
    { id: 'quests', name: 'Quests', url: `${WH}/quests`, Icon: Scroll, match: /^\/(quests|quest=)/ },
    { id: 'maps', name: 'Karten', url: `${WH}/maps`, Icon: MapIcon, match: /^\/(maps?|zone=)/ },
    { id: 'db', name: 'Datenbank', url: `${WH}/database`, Icon: Database, match: /^\/(database|npcs?|npc=|spells?|spell=|objects?|object=)/ },
    { id: 'guides', name: 'Guides', url: `${WH}/guides`, Icon: BookOpen, match: /^\/guides?/ },
    { id: 'news', name: 'News', url: WH, Icon: Newspaper, match: /^\/?$/ },
  ],
}]
export const BOX = BOXES[0]

/** A tool's address in the chosen language ('de' | 'en'). */
export function toolUrl(tool, lang = 'de') {
  return lang === 'de' ? tool.url.replace('/forever', '/forever/de') : tool.url
}

const LOCALE = /^\/forever(?:\/(?:de|en|fr|es|ru|it|pt|ko|cn|mx|tw))?(?=\/|$)/i
/** The part after /forever (and the language), '' for other sites. */
export function restOf(url) {
  try {
    const u = new URL(url)
    if (!/(^|\.)wowhead\.com$/i.test(u.hostname) || !LOCALE.test(u.pathname)) return ''
    return u.pathname.replace(LOCALE, '') || '/'
  } catch { return '' }
}

/** A Wowhead list page (items, quests …): its address without filters, for our search field ("…/name:Text"). */
export function listOf(url) {
  const rest = restOf(url)
  const m = rest.match(/^\/(items|quests|npcs|spells|objects|zones)(?=[/?]|$)/i)
  if (!m) return null
  const head = url.slice(0, url.indexOf(rest))
  return { base: head + '/' + m[1].toLowerCase(), what: { items: 'Items', quests: 'Quests', npcs: 'NPCs', spells: 'Zauber', objects: 'Objekte', zones: 'Gebiete' }[m[1].toLowerCase()] }
}

/** Which tool a page belongs to (for the active tab). */
export const toolOf = url => {
  const rest = restOf(url)
  return rest ? BOX.tools.find(t => t.match.test(rest)) || null : null
}

const WHAT = { item: 'Item', quest: 'Quest', npc: 'NPC', spell: 'Zauber', zone: 'Gebiet', object: 'Objekt', faction: 'Fraktion' }

/**
 * What an address is: { box, kind: 'build' | 'item' | 'page', cls?, what? }; null for an
 * address that isn't one at all. Other sites count as a page without a box.
 */
export function classify(url) {
  let u
  try { u = new URL(url) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  // our own character links (auchgit.github.io/wow/?c=…) and build links (…/wow/?b=warrior/05-5)
  const ch = charFrom(url)
  if (ch && /auchgit\.github\.io|localhost/.test(u.hostname)) return { box: BOX.id, kind: 'build', cls: ch.cls, what: 'Charakter', char: true }
  const code = buildText(url)
  if (code) return { box: BOX.id, kind: 'build', cls: code.split('/')[0].toLowerCase(), what: 'Talente' }
  const rest = restOf(url)
  if (!rest) return { box: null, kind: 'page' }
  const t = rest.match(/^\/talent-calc\/([a-z]+)(?:\/([^?#]+))?/i)
  if (t) {
    const cls = CLASSES[t[1].toLowerCase()] ? t[1].toLowerCase() : null
    return { box: BOX.id, kind: t[2] ? 'build' : 'page', cls, what: 'Talente' }
  }
  const d = rest.match(/^\/(item|quest|npc|spell|zone|object|faction)=(\d+)/i)
  if (d) return { box: BOX.id, kind: d[1].toLowerCase() === 'item' ? 'item' : 'page', what: WHAT[d[1].toLowerCase()] }
  return { box: BOX.id, kind: 'page', what: toolOf(url)?.name || null }
}

/** A good name from the page's title (Wowhead: "Name - Item - WoW Forever"), else from the address. */
export function nameFor(url, title, info = classify(url)) {
  if (info?.char) return buildNameIn(url) || `${CLASSES[info.cls]?.name || 'Held'} (Charakter)`
  if (info?.kind === 'build') return buildNameIn(url) || `${CLASSES[info.cls]?.name || 'Talent'}-Build`
  let t = String(title || '').replace(/^\[(.*)\]$/, '$1')
  t = t.replace(/\s+-\s+(Item|Gegenstand|Quest|NPC|Spell|Zauber|Zone|Gebiet|Object|Objekt|Faction|Fraktion|Guide)\s+-\s+.*$/i, '')
    .replace(/\s+-\s+(WoW Forever|Wowhead|World of Warcraft).*$/i, '').trim()
  if (t) return t.slice(0, 120)
  // the slug after "item=123/…"
  const slug = (() => { try { return new URL(url).pathname.split('/').pop() } catch { return '' } })()
  if (slug && !/=/.test(slug)) return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 120)
  try { return new URL(url).hostname } catch { return 'Seite' }
}

/** Kind labels for lists and chat cards. */
export const KIND_LABEL = { build: 'Build', item: 'Item', page: 'Seite' }
/** "Build" / "Charakter" / "Item" / "Seite" for an entry. */
export const kindLabel = e => (e?.url && /[?&]c=/.test(e.url) && classify(e.url)?.char ? 'Charakter' : KIND_LABEL[e?.kind] || 'Seite')

/** A chat message that is only a WoW Forever link: shown as a card too. */
export function toolLink(body) {
  const s = String(body || '').trim()
  return /^https?:\/\/\S+$/.test(s) && (restOf(s) || buildText(s) || classify(s)?.char) ? s : null
}
