// WoW characters in your account (sql/wow-characters.sql): yours go up from the launcher
// (only what you share, lib/wowChar.js forCloud), friends' come down for their profile, the
// launcher's "Charaktere" and the app. Without the SQL everything stays on the PC (no errors).
// The website has a copy (scripts/sync-web-toolbox.py).
import { create } from 'zustand'
import { supabase } from '../../lib/supabase'
import { forCloud } from './wowChar'

const SENT = 'auch.wowCloudSent'
const sum = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
const missing = e => /does not exist|42P01|schema cache/i.test(String(e?.message || e?.code || ''))

export const useWowCloud = create((set, get) => ({
  /** [{ user_id, key, data, updated_at }] (yours and friends') */
  rows: [],
  loaded: false,
  /** the SQL isn't there yet */
  off: false,
  error: null,

  async load() {
    if (!supabase) return []
    const { data, error } = await supabase.from('wow_characters').select('user_id,key,data,updated_at').order('updated_at', { ascending: false }).limit(400)
    if (error) { set({ loaded: true, off: missing(error), error: missing(error) ? null : error.message }); return [] }
    set({ rows: data || [], loaded: true, off: false, error: null })
    return data || []
  },
  of(userId) { return get().rows.filter(r => r.user_id === userId) },

  /** Your characters up (only those that changed since the last time). */
  async upload(players, share = {}, userId) {
    if (!supabase || !userId || get().off || share.on === false) return 0
    let sent = {}
    try { sent = JSON.parse(localStorage.getItem(SENT)) || {} } catch { /* none */ }
    // the same character under its old key (AuchAddOn up to 1.6: "Name-Lastname" in WoW Forever) goes
    if (!get().loaded) await get().load()
    const keys = new Set((players || []).map(p => p?.key))
    const stale = get().rows.filter(r => r.user_id === userId && !keys.has(r.key) && (players || []).some(p =>
      p?.full && p.name === r.data?.name && p.cls === r.data?.cls && r.key === `${p.name}-${p.full.split(' ').slice(1).join(' ')}`))
    for (const r of stale) {
      await get().remove(userId, r.key).catch(() => {})
      delete sent[userId + ':' + r.key]
    }
    const rows = []
    for (const p of players || []) {
      if (!p?.key || !p.name) continue
      const data = forCloud(p, share)
      const h = sum(JSON.stringify(data))
      if (sent[userId + ':' + p.key] === h) continue
      rows.push({ row: { user_id: userId, key: p.key, data }, h })
    }
    if (!rows.length) return 0
    const { error } = await supabase.from('wow_characters').upsert(rows.map(r => r.row), { onConflict: 'user_id,key' })
    if (error) { set({ off: missing(error), error: missing(error) ? null : error.message }); return 0 }
    for (const r of rows) sent[userId + ':' + r.row.key] = r.h
    try { localStorage.setItem(SENT, JSON.stringify(sent)) } catch { /* full */ }
    return rows.length
  },

  /** One of yours away from the account. */
  async remove(userId, key) {
    if (!supabase) return
    await supabase.from('wow_characters').delete().eq('user_id', userId).eq('key', key)
    set({ rows: get().rows.filter(r => !(r.user_id === userId && r.key === key)) })
  },
}))
