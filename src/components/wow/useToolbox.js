// Saved builds, items and pages from the toolboxes (lib/toolbox.js). Kept on this PC (the
// launcher window and the overlay share it, a change shows up in both) and, once
// sql/toolbox.sql ran, in your account too: other devices, and a new PC has them all.
//
//   saves  [{ id, box, kind: 'build' | 'item' | 'page', title, url, cls, note, at, synced }] newest first
//   cloud  null: not asked yet, true: in the account, false: only here (table missing / offline)
//   want   { url, n }: open this (from the chat, a list); the toolbox that's up goes there
//   shared what friends sent you in chats (messages with payload.tool), grouped by sender in the
//          list: [{ id: 'm:<message id>', from, kind, title, url, cls, at }], newest first; on login
//          from your chats, then live. `hidden`: the ones you took away.
import { create } from 'zustand'
// small settings in this browser (same keys as the launcher)
const PREFIX = 'auch.'
const load = (k, d) => { try { const r = localStorage.getItem(PREFIX + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch { /* blocked */ } }
import { supabase } from '../../lib/supabase'
import { useSocial } from '../chat/useSocial'
import { classify, nameFor } from './toolbox'
import { buildText, codeUrl } from './wowTalents'

const KEY = 'toolboxSaves'
const GONE = 'toolboxGone' // deleted here while the account couldn't be reached
const HIDDEN = 'toolboxHidden'
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)))
const me = () => useSocial.getState().session?.user?.id || null
const table = () => supabase.from('toolbox_saves')
const row = s => ({ id: s.id, box: s.box || null, kind: s.kind, title: s.title, url: s.url, cls: s.cls || null, note: s.note || '', at: new Date(s.at).toISOString() })
const sorted = list => [...list].sort((a, b) => b.at - a.at)

// where "open this" goes: the launcher's toolbox page, or the overlay's toolbox window
let opener = null
export const setToolOpener = fn => { opener = fn }
/** Opens an address in the toolbox (launcher page / overlay window). */
export function openTool(url) {
  useToolbox.getState().open(url)
  opener?.(url)
}

/** A shared tool from a chat message, or null. */
function fromMessage(m) {
  const t = m?.payload?.tool
  if (!t?.url || !/^https?:\/\//i.test(t.url)) return null
  return { id: 'm:' + m.id, from: m.sender, box: t.box || null, kind: ['build', 'item', 'page'].includes(t.kind) ? t.kind : 'page', title: String(t.title || '').slice(0, 160) || 'Geteilt', url: t.url, cls: t.cls || null, at: Date.parse(m.created_at) || Date.now() }
}
/** One per sender and address (the newest). */
const dedupe = list => {
  const seen = new Set()
  return list.filter(e => { const k = e.from + ' ' + e.url; if (seen.has(k)) return false; seen.add(k); return true })
}

export const useToolbox = create((set, get) => ({
  saves: load(KEY, []),
  shared: [],
  hidden: load(HIDDEN, []),
  cloud: null,
  want: null,
  lang: load('toolboxLang', 'de'),

  setLang(lang) { save('toolboxLang', lang); set({ lang }) },
  open(url) { set({ want: { url, n: Date.now() } }) },
  _put(saves) { saves = sorted(saves); save(KEY, saves); set({ saves }) },

  /**
   * Saves an address (the same one again: updated, not twice). A build is the same entry when
   * it has the same name and class (points changed) or the same points (name changed).
   */
  keep({ url, title, note }) {
    const info = classify(url) || { box: null, kind: 'page' }
    const code = buildText(url)
    const cls = code?.split('/')[0]
    const old = get().saves.find(x => x.url === url)
      || (code && title && get().saves.find(x => x.kind === 'build' && x.title === title && buildText(x.url)?.split('/')[0] === cls))
      || (code && get().saves.find(x => buildText(x.url) === code))
    const entry = old
      ? { ...old, url, ...(title ? { title } : {}), ...(note != null ? { note } : {}), at: Date.now(), synced: false }
      : { id: newId(), box: info.box, kind: info.kind, cls: info.cls || null, title: (title || nameFor(url, '', info)).slice(0, 160), url, note: note || '', at: Date.now(), synced: false }
    get()._put([entry, ...get().saves.filter(x => x.id !== entry.id)])
    get()._up(entry)
    return entry
  },
  update(id, patch) {
    const old = get().saves.find(x => x.id === id)
    if (!old) return
    const entry = { ...old, ...patch, title: String(patch.title ?? old.title).trim().slice(0, 160) || old.title, at: Date.now(), synced: false }
    // a renamed build: its link carries the new name too
    const code = buildText(entry.url)
    if (code && patch.title != null) entry.url = codeUrl(code, entry.title)
    get()._put(get().saves.map(x => (x.id === id ? entry : x)))
    get()._up(entry)
  },
  async remove(id) {
    get()._put(get().saves.filter(x => x.id !== id))
    if (!get().cloud || !me()) { save(GONE, [...load(GONE, []), id]); return }
    const { error } = await table().delete().eq('id', id)
    if (error) save(GONE, [...load(GONE, []), id])
  },
  /** Into the account (if there is one for this). */
  async _up(entry) {
    if (!get().cloud || !me()) return
    const { error } = await table().upsert(row(entry))
    if (!error) get()._put(get().saves.map(x => (x.id === entry.id && x.at === entry.at ? { ...x, synced: true } : x)))
  },

  /** Brings this PC and the account together: new ones up, others' down, deleted ones away. */
  async sync() {
    if (!supabase || !me()) return
    const { data, error } = await table().select('id, box, kind, title, url, cls, note, at')
    if (error) { set({ cloud: false }); return }
    set({ cloud: true })
    const remote = new Map((data || []).map(r => [r.id, { ...r, at: Date.parse(r.at), synced: true }]))
    const gone = load(GONE, [])
    const out = []
    for (const s of get().saves) {
      const r = remote.get(s.id)
      remote.delete(s.id)
      if (r) out.push(r.at >= s.at ? r : { ...s, synced: false })
      else if (!s.synced) out.push(s) // new here
      // else: deleted on another device
    }
    for (const r of remote.values()) {
      if (gone.includes(r.id)) await table().delete().eq('id', r.id)
      else out.push(r)
    }
    save(GONE, [])
    get()._put(out)
    for (const s of out) if (!s.synced) await get()._up(s)
  },

  /** What friends shared in your chats (newest 200 messages with a build / item / page). */
  async loadShared() {
    const uid = me()
    if (!supabase || !uid) return
    const { data, error } = await supabase.from('social_messages').select('id, sender, payload, created_at')
      .not('payload->tool', 'is', null).neq('sender', uid).order('created_at', { ascending: false }).limit(200)
    if (!error) set({ shared: dedupe((data || []).map(fromMessage).filter(Boolean)) })
  },
  _heard(m) {
    if (!m?.payload?.tool || !m.sender || m.sender === me()) return
    const e = fromMessage(m)
    if (e) set({ shared: dedupe([e, ...get().shared]) })
  },
  /** Out of the list (stays in the chat). */
  hide(id) {
    const hidden = [...new Set([...get().hidden, id])].slice(-500)
    save(HIDDEN, hidden)
    set({ hidden })
  },
  /** Into your own list. */
  adopt(e) { return get().keep({ url: e.url, title: e.title }) },

  /** To a friend (their direct chat, made if needed) or a chat: { friend: userId } | { conv: id }. */
  async shareTo(entry, to) {
    let conv = to.conv
    if (!conv && to.friend) {
      const { data, error } = await supabase.rpc('social_open_direct', { other: to.friend })
      if (error || !data) throw new Error('Der Chat ließ sich nicht öffnen.')
      conv = data
    }
    await get().share(entry, conv)
    return conv
  },

  /** Sends a saved one (or any address) into a chat: a card there, a plain link for old apps. */
  async share(entry, convId) {
    const info = classify(entry.url) || {}
    const tool = { box: entry.box ?? info.box ?? null, kind: entry.kind || info.kind || 'page', title: entry.title, url: entry.url, cls: entry.cls ?? info.cls ?? null }
    await useSocial.getState().send(`${entry.title}\n${entry.url}`, { payload: { tool } }, convId)
  },
}))

// the other window (launcher / overlay) changed something
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === 'auch.' + KEY) useToolbox.setState({ saves: load(KEY, []) })
    if (e.key === 'auch.toolboxLang') useToolbox.setState({ lang: load('toolboxLang', 'de') })
  })
}

// new messages: shared builds land in the list right away (the chat store's message hook)
let hooked = false
function hook() {
  const prev = useSocial.getState()._onMessage
  if (hooked || typeof prev !== 'function') return
  hooked = true
  useSocial.setState({ _onMessage: m => { prev(m); try { useToolbox.getState()._heard(m) } catch { /* never in the chat's way */ } } })
}

// after logging in: once with the account
let syncedFor = null
useSocial.subscribe(s => {
  const id = s.session?.user?.id || null
  if (id && id !== syncedFor) {
    syncedFor = id
    hook()
    setTimeout(() => {
      useToolbox.getState().sync().catch(() => {})
      useToolbox.getState().loadShared().catch(() => {})
    }, 1500)
  }
  if (!id) { syncedFor = null; useToolbox.setState({ shared: [] }) }
})
