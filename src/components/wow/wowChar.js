// A WoW character as the AuchAddOn saves it (AuchAddOnDB.players): pure helpers, no imports,
// shared by the launcher and the website (scripts/sync-web-toolbox.py copies this file).
//   { name, full (first and last name, WoW Forever), realm, cls, race, level, xp, xpMax, money, zone, guild, talents, free, gear "id.id…",
//     bags "id:SLOT …", inv "id:n …", bank "id:n …", bankAt, auctions [{ id, c, b, l, s }],
//     auctionsAt, profs [{ n, r, m }], recipes { [profession]: "id:name;…" }, reps [{ n, s, v, m }], quests [...],
//     rested, resting, at }

/**
 * Rested experience now, worked out from the last save: 5 % of a level per 8 hours in an inn
 * or a city (a quarter of that elsewhere), at most 1.5 levels.
 * -> { now, pct (of the level), full (hours until full, 0 = full), resting } or null (max level).
 */
export function restedNow(p, nowSec = Date.now() / 1000) {
  if (!p || !p.xpMax || (p.level || 0) >= 60) return null
  const cap = p.xpMax * 1.5
  const per8 = p.xpMax * 0.05 * (p.resting ? 1 : 0.25)
  const hours = Math.max(0, (nowSec - (p.at || nowSec)) / 3600)
  const now = Math.min(cap, (Number(p.rested) || 0) + (per8 * hours) / 8)
  return { now, pct: (now / p.xpMax) * 100, full: now >= cap ? 0 : ((cap - now) / per8) * 8, resting: !!p.resting }
}

/** The name to show: the whole one (first and last) when the game gave it. */
export const nameOf = p => (p?.full && String(p.full).trim()) || p?.name || ''

/** "12 Std." / "3 T." */
export const hoursText = h => (h >= 48 ? `${Math.round(h / 24)} T.` : `${Math.max(1, Math.round(h))} Std.`)

/** Items "id:count id:count" -> [{ id, n }]. */
export function itemList(text) {
  return String(text || '').split(' ').map(x => { const [id, n] = x.split(':'); return { id: Number(id), n: Number(n) || 1 } }).filter(x => x.id > 0)
}

/** Recipes of one profession ("id:name;…", negative id = a spell like an enchant) -> [{ id, n }]. */
export function recipeList(text) {
  return String(text || '').split(';').map(x => { const k = x.indexOf(':'); return k > 0 ? { id: Number(x.slice(0, k)) || 0, n: x.slice(k + 1) } : null }).filter(x => x && x.n)
}

/** Gold, silver, copper from copper. */
export function coins(c) {
  const n = Math.max(0, Math.floor(Number(c) || 0))
  return { g: Math.floor(n / 10000), s: Math.floor(n / 100) % 100, c: n % 100 }
}

/** Reputation standings 1..8. */
export const STANDINGS = { 1: ['Hasserfüllt', '#cc3333'], 2: ['Feindselig', '#ff4040'], 3: ['Unfreundlich', '#ee6622'], 4: ['Neutral', '#e6c84d'],
  5: ['Freundlich', '#4fb34f'], 6: ['Wohlwollend', '#3fbf7f'], 7: ['Respektvoll', '#3fbfbf'], 8: ['Ehrfürchtig', '#7f9fff'] }

/** Time left of an auction (the game's 1..4). */
export const AUCTION_LEFT = { 1: '< 30 Min.', 2: '30 Min. - 2 Std.', 3: '2 - 8 Std.', 4: '> 8 Std.' }

/** Classic quest colors by the level gap. */
export function questColor(q, me) {
  const d = (q || 0) - (me || 0)
  if (d >= 5) return '#ff4d4d'
  if (d >= 3) return '#ff8f40'
  if (d >= -2) return '#ffd84d'
  const gray = me <= 5 ? 0 : me <= 39 ? me - Math.floor(me / 10) - 5 : me <= 59 ? me - Math.floor(me / 5) - 1 : me - 9
  return q > gray ? '#4fd46a' : '#8a8a92'
}

/** Points per tree from the talent text ("shaman/05-0503-…"): [n, n, n]. */
export function treePoints(talents) {
  const ranks = String(talents || '').split('/')[1] || ''
  return ranks.split('.')[0].split('-').map(t => [...t].reduce((a, c) => a + (Number(c) || 0), 0))
}

/** What you can share (settings wowShare; all on unless switched off). */
export const SHARE_PARTS = [
  ['gear', 'Ausrüstung'], ['talents', 'Talente'], ['inv', 'Taschen'], ['bank', 'Bank'], ['auctions', 'Auktionen'],
  ['profs', 'Berufe'], ['reps', 'Ruf'], ['money', 'Gold'], ['quests', 'Quests'], ['rested', 'Erholt-EP'],
]

/** A character for your account (only what you share). */
export function forCloud(p, share = {}) {
  const on = k => share[k] !== false
  const out = { name: p.name, full: p.full, realm: p.realm, cls: p.cls, race: p.race, level: p.level, xp: p.xp, xpMax: p.xpMax, zone: p.zone, guild: p.guild, at: p.at }
  if (on('gear')) { out.gear = p.gear; out.bags = p.bags }
  if (on('talents')) { out.talents = p.talents; out.free = p.free }
  if (on('inv')) out.inv = p.inv
  if (on('bank')) { out.bank = p.bank; out.bankAt = p.bankAt }
  if (on('auctions')) { out.auctions = p.auctions; out.auctionsAt = p.auctionsAt }
  if (on('profs')) { out.profs = p.profs; out.recipes = p.recipes }
  if (on('reps')) out.reps = p.reps
  if (on('money')) out.money = p.money
  if (on('quests')) out.quests = (p.quests || []).slice(0, 25)
  if (on('rested')) { out.rested = p.rested; out.resting = p.resting }
  return out
}
