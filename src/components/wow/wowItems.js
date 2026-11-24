// WoW Forever items through our server function "wow" (supabase/functions/wow: Blizzard's
// official data, the key stays there). Items are kept on this device for a week.
// The website has a copy of this file (scripts/sync-web-toolbox.py).
import { supabase } from '../../lib/supabase'

export const QUALITY = {
  POOR: '#9d9d9d', COMMON: '#ffffff', UNCOMMON: '#1eff00', RARE: '#0070dd', EPIC: '#a335ee', LEGENDARY: '#ff8000', ARTIFACT: '#e6cc80', HEIRLOOM: '#00ccff',
}
export const itemUrl = id => `https://www.wowhead.com/forever/item=${id}`
/** The item id in a Wowhead item link (any version), else null. */
export function itemIdOf(url) {
  const m = String(url || '').match(/wowhead\.com\/[^?#]*?item=(\d+)/i)
  return m ? Number(m[1]) : null
}

const KEY = 'auch.wowItem.'
const WEEK = 7 * 864e5
const cached = id => { try { const v = JSON.parse(localStorage.getItem(KEY + id)); return v && Date.now() - v.at < WEEK ? v.item : null } catch { return null } }
const keep = item => { try { localStorage.setItem(KEY + item.id, JSON.stringify({ at: Date.now(), item })) } catch { /* full */ } }
export const itemNow = id => cached(id)

/** 'setup': the function or the Blizzard key is missing (the toolbox says how). */
export class NotReady extends Error { constructor(why) { super(why); this.why = why } }

async function call(body) {
  if (!supabase) throw new NotReady('setup')
  const { data, error } = await supabase.functions.invoke('wow', { body })
  if (error) {
    // not deployed yet: 404 from the gateway
    const status = error.context?.status
    if (status === 404 || /not found/i.test(error.message || '')) throw new NotReady('setup')
    throw new Error('Die Item-Daten antworten gerade nicht.')
  }
  if (data?.error === 'setup') throw new NotReady('setup')
  if (data?.error) throw new Error(data.error === 'blizzard' ? `Blizzard antwortet nicht (${data.status}).` : 'Die Item-Daten antworten gerade nicht.')
  return data
}

/** { items, pages, ns } */
export async function searchItems(q, page = 1) {
  const r = await call({ type: 'search', q, page })
  return { items: r.items || [], pages: r.pages || 0, ns: r.ns }
}

export async function getItem(id) {
  const hit = cached(id)
  if (hit) return hit
  const r = await call({ type: 'item', id })
  if (r.item) keep({ ...r.item, ns: r.ns })
  return { ...r.item, ns: r.ns }
}

/** Data from Classic Era instead of WoW Forever (Blizzard has no Forever data yet). */
export const fallbackData = ns => !!ns && !/forever/i.test(ns)
