// WoW Forever talent calculator: data and rules. Data from talentsforever.com (CC BY 4.0,
// see scripts/wow-talents.mjs): the website keeps a fresh copy (/api/wow-forever/talents.json,
// rebuilt hourly), the app has one bundled in case that can't be reached.
//
// Rules like the classic trees: 51 points (the first at level 10), a row needs 5 points per
// row above it in that tree, a talent with a requirement needs that one at full rank, and a
// point can only come out if everything above still holds.
//
// A build is { cls, ranks: [[rank per talent] per tree], order? }; as text "warrior/0505-32"
// (per tree its talents' ranks in grid order, trailing zeros left out), plus the order the
// points were clicked in after a dot ("warrior/0505-32.ABAB…": one sign per point = level 10,
// 11, …), as a link https://auchgit.github.io/wow/?b=warrior/0505-32.ABAB&n=Furor%20Raid
// (website, launcher and overlay open it; n = the build's own name, optional). Without the
// order (older links) orderOf works one out.
export const SITE = 'https://auchgit.github.io'
export const POINTS = 51
const LIVE = `${SITE}/api/wow-forever/talents.json`

/** Talent symbols from Blizzard's own image server. */
export const iconUrl = (name, size = 56) => `https://render.worldofwarcraft.com/eu/icons/${size}/${name || 'inv_misc_questionmark'}.jpg`

let data = null
let loading = null
/** The talent data: the website's fresh copy, else the bundled one. */
export function loadTalents() {
  if (data) return Promise.resolve(data)
  loading ||= (async () => {
    try {
      const r = await fetch(LIVE, { cache: 'no-cache' })
      if (r.ok) {
        const j = await r.json()
        if (j?.classes?.warrior?.trees?.length === 3) return (data = j)
      }
    } catch { /* offline: bundled */ }
    return (data = (await import('./wow-forever-talents.json')).default)
  })()
  return loading
}
export const talentsNow = () => data

export const emptyBuild = (d, cls) => ({ cls, ranks: d.classes[cls].trees.map(t => t.talents.map(() => 0)) })
export const total = b => b.ranks.reduce((a, t) => a + t.reduce((x, y) => x + y, 0), 0)
export const treePoints = (b, t) => b.ranks[t].reduce((x, y) => x + y, 0)
/** Level needed for this many points (first point at 10). */
export const levelFor = b => (total(b) ? total(b) + 9 : null)
export const split = b => b.ranks.map((_, t) => treePoints(b, t)).join('/')

const indexOf = (tree, name) => tree.talents.findIndex(x => x.n === name)

/** Why talent i of tree t can't get a point now (German, for the tooltip); null if it can. */
export function whyNot(d, b, t, i) {
  const tree = d.classes[b.cls].trees[t]
  const x = tree.talents[i]
  if (b.ranks[t][i] >= x.m) return 'Voll'
  const need = (x.r - 1) * 5
  if (treePoints(b, t) < need) return `Braucht ${need} Punkte in ${tree.name}`
  if (x.q) {
    const j = indexOf(tree, x.q)
    if (j >= 0 && b.ranks[t][j] < tree.talents[j].m) return `Braucht ${x.q} (${tree.talents[j].m}/${tree.talents[j].m})`
  }
  if (total(b) >= POINTS) return 'Keine Punkte mehr übrig'
  return null
}
export const canAdd = (d, b, t, i) => whyNot(d, b, t, i) === null

/** Can a point of talent i in tree t come out without breaking anything above it? */
export function canRemove(d, b, t, i) {
  const tree = d.classes[b.cls].trees[t]
  const x = tree.talents[i]
  if (!b.ranks[t][i]) return false
  if (tree.talents.some((y, j) => y.q === x.n && b.ranks[t][j] > 0)) return false
  const after = [...b.ranks[t]]
  after[i] -= 1
  for (let k = x.r + 1; k <= 7; k++) {
    const used = tree.talents.some((y, j) => y.r === k && after[j] > 0)
    if (!used) continue
    const below = tree.talents.reduce((a, y, j) => a + (y.r < k ? after[j] : 0), 0)
    if (below < (k - 1) * 5) return false
  }
  return true
}

const change = (b, t, i, by) => ({ ...b, ranks: b.ranks.map((r, n) => (n === t ? r.map((v, j) => (j === i ? v + by : v)) : r)) })
// ranks only (for rule checks while placing points), the order stays as it is
const put = (d, b, t, i) => (canAdd(d, b, t, i) ? change(b, t, i, 1) : b)

/** The click order if the build has a complete one: [[tree, talent] per point], else null. */
const ownOrder = b => (Array.isArray(b.order) && b.order.length && b.order.length === total(b) ? b.order : null)
/** The order to work with: the clicked one, else the worked-out one. */
const seq = (d, b) => ownOrder(b) || orderOf(d, b).map(s => [s.t, s.i])

/**
 * An order replayed through the rules: a point that isn't allowed yet at its place (a point
 * below it came out) waits until it is, then comes right after.
 */
function fixOrder(d, cls, order) {
  let cur = emptyBuild(d, cls)
  const out = []
  const wait = []
  const drain = () => {
    for (let k = 0; k < wait.length; k++) {
      const [t, i] = wait[k]
      if (!canAdd(d, cur, t, i)) continue
      cur = put(d, cur, t, i)
      out.push([t, i])
      wait.splice(k, 1)
      k = -1
    }
  }
  for (const [t, i] of order) {
    if (canAdd(d, cur, t, i)) { cur = put(d, cur, t, i); out.push([t, i]); drain() } else wait.push([t, i])
  }
  return out
}

/** A point (it goes to the end of the order). */
export function add(d, b, t, i) {
  if (!canAdd(d, b, t, i)) return b
  return { ...change(b, t, i, 1), order: [...seq(d, b), [t, i]] }
}
/** A point out: the last one of this talent leaves the order. */
export function remove(d, b, t, i) {
  if (!canRemove(d, b, t, i)) return b
  const order = [...seq(d, b)]
  for (let k = order.length - 1; k >= 0; k--) if (order[k][0] === t && order[k][1] === i) { order.splice(k, 1); break }
  return { ...change(b, t, i, -1), order: fixOrder(d, b.cls, order) }
}
/** As many points as fit (shift-click). */
export function addAll(d, b, t, i) {
  let n = b
  while (canAdd(d, n, t, i)) n = add(d, n, t, i)
  return n
}
/** All points of this talent out, if nothing above needs them. */
export function removeAll(d, b, t, i) {
  let n = b
  while (canRemove(d, n, t, i)) n = remove(d, n, t, i)
  return n
}
/** Forget the clicked order (the worked-out one counts again). */
export const autoOrder = b => ({ cls: b.cls, ranks: b.ranks })

// the order as text: one sign per point, tree * 21 + talent (up to 20 talents per tree)
const SIGNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const PER = 21

export function encode(b) {
  const ranks = `${b.cls}/${b.ranks.map(r => r.join('').replace(/0+$/, '')).join('-').replace(/-+$/, '')}`
  const order = ownOrder(b)
  return order ? `${ranks}.${order.map(([t, i]) => SIGNS[t * PER + i]).join('')}` : ranks
}

/**
 * A build from its text. Points are placed in grid order through the rules, so a broken or
 * old code (talents changed since) gives the nearest valid build instead of nonsense.
 */
export function decode(d, text) {
  const m = String(text || '').trim().match(/^([a-z]+)\/([0-9-]*)(?:\.([A-Za-z0-9_-]*))?$/i)
  if (!m || !d.classes[m[1].toLowerCase()]) return null
  const cls = m[1].toLowerCase()
  const parts = m[2].split('-')
  let b = emptyBuild(d, cls)
  const trees = d.classes[cls].trees
  // row by row over all trees, so requirements come before what needs them
  for (let row = 1; row <= 7; row++) {
    trees.forEach((tree, t) => {
      tree.talents.forEach((x, i) => {
        if (x.r !== row) return
        const want = Math.min(Number(parts[t]?.[i] || 0), x.m)
        for (let k = 0; k < want; k++) b = put(d, b, t, i)
      })
    })
  }
  // the clicked order: kept if it is exactly these points in an allowed order
  if (m[3]) {
    const order = []
    for (const ch of m[3]) {
      const v = SIGNS.indexOf(ch)
      const t = Math.floor(v / PER)
      const i = v % PER
      if (v < 0 || !trees[t]?.talents[i]) return b
      order.push([t, i])
    }
    const fixed = fixOrder(d, cls, order)
    const counts = b.ranks.map(r => r.map(() => 0))
    for (const [t, i] of fixed) counts[t][i]++
    if (fixed.length === order.length && counts.every((r, t) => r.every((v, i) => v === b.ranks[t][i]))) b = { ...b, order: fixed }
  }
  return b
}

/** A build as text (with or without the order). */
export const BUILD_TEXT = /^[a-z]+\/[0-9-]*(\.[A-Za-z0-9_-]*)?$/i

/** Our link for a build text (and its name). */
export const codeUrl = (code, name) => `${SITE}/wow/?b=${code}${name?.trim() ? `&n=${encodeURIComponent(name.trim().slice(0, 80))}` : ''}`
export const buildUrl = (b, name) => codeUrl(encode(b), name)
/** The build's own name in one of our links ('' if none). */
export function buildNameIn(url) {
  try { return new URL(url).searchParams.get('n')?.trim().slice(0, 80) || '' } catch { return '' }
}
/** The build text in one of our links (or a bare "warrior/05-5"), else null. */
export function buildText(url) {
  const s = String(url || '').trim()
  if (BUILD_TEXT.test(s)) return s
  try {
    const u = new URL(s)
    const own = typeof location !== 'undefined' ? location.hostname : ''
    if (u.hostname !== new URL(SITE).hostname && u.hostname !== own) return null
    if (!/^\/wow\/?$/.test(u.pathname)) return null
    return u.searchParams.get('b')
  } catch { return null }
}

/** "Krieger 31/20/0" */
export const buildName = (d, b) => `${d.classes[b.cls]?.name || b.cls} ${split(b)}`

/**
 * The order to put the points in while leveling (one per level from 10): the main tree first
 * (most points), the lowest open row first, left to right, so each point is allowed when it
 * comes. [{ t, i, r, c, n }] per point (tree, index in grid order, row, column, name).
 */
export function orderOf(d, b) {
  const trees = d.classes[b.cls].trees
  const prio = trees.map((_, t) => t).sort((x, y) => treePoints(b, y) - treePoints(b, x))
  let cur = emptyBuild(d, b.cls)
  const out = []
  for (let k = 0; k < total(b); k++) {
    let pick = null
    for (const t of prio) {
      const open = trees[t].talents
        .map((x, i) => ({ x, i }))
        .filter(({ i }) => cur.ranks[t][i] < b.ranks[t][i] && canAdd(d, cur, t, i))
        .sort((p, q) => p.x.r - q.x.r || p.x.c - q.x.c)
      if (open.length) { pick = { t, ...open[0] }; break }
    }
    if (!pick) break
    cur = put(d, cur, pick.t, pick.i)
    out.push({ t: pick.t, i: pick.i, r: pick.x.r, c: pick.x.c, n: pick.x.n })
  }
  return out
}

/** The leveling order: as clicked in the calculator, else worked out (orderOf). Same shape. */
export function orderFor(d, b) {
  const own = ownOrder(b)
  if (!own) return orderOf(d, b)
  const trees = d.classes[b.cls].trees
  return own.map(([t, i]) => { const x = trees[t].talents[i]; return { t, i, r: x.r, c: x.c, n: x.n } })
}
/** Is the order the one you clicked (not worked out)? */
export const ownOrderIn = b => !!ownOrder(b)
/** Per talent the levels its points come at: { "t:i": [10, 14] }. */
export function levelsOf(d, b) {
  const out = {}
  orderFor(d, b).forEach((s, k) => { (out[s.t + ':' + s.i] ||= []).push(k + 10) })
  return out
}
