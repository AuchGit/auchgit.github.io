// Account, friends, presence and direct chat in the launcher.
//
//   session   undefined while loading, null when signed out
//   me        own profile (name, friend code, picture)
//   friends   friends + open requests (social_friends)
//   convs     conversations with unread counts (social_conversations_list)
//   online    userId -> presence payload { name, game } for everyone online
//   stage     sidebar: 'rail' (avatars only) or 'open' (friend list)
//   chat      the open chat: { convId, kind: 'direct', friend } or
//             { convId, kind: 'group', title, members }
//   views     more chats open at the same time (overlay windows), same shape, by convId
//   status    own status: online | afk | dnd | invisible (looks offline) | offline (really off)
//
// Live: friendship changes and new messages via Postgres changes (RLS keeps
// them to your own), presence via one shared Realtime channel.

import { create } from 'zustand'
import { supabase, germanError } from '../../lib/supabase'

const WELCOME_URL = typeof location !== 'undefined' ? location.origin + '/willkommen/' : '/willkommen/'
const load = (k, d) => { try { const v = localStorage.getItem('auch.' + k); return v == null ? d : JSON.parse(v) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem('auch.' + k, JSON.stringify(v)) } catch { /* ignore */ } }
const desktop = {
  notify(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/favicon.svg', tag: 'auch-chat' })
    } catch { /* ignore */ }
  },
}

const PROFILE_REFRESH = 5 * 60 * 1000
let channels = []
let presence = null
let timers = []
let inited = false
const convChannels = new Map() // open chats: typing and read receipts (broadcast, nothing stored)
const lastTypingPing = new Map()
const leftAt = {} // userId -> when they went offline (no "online" sound for a quick reconnect)
let connectedAt = 0
const TYPING_MS = 4000
const VIDEO_MAX = 15 * 1024 * 1024
const GIF_MAX = 8 * 1024 * 1024
const signed = new Map() // storage path -> { url, until }

/** Pictures get smaller before upload: max 1600 px, WebP. GIFs and videos stay as they are. */
async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.82))
  return { blob: blob || file, w, h }
}

function videoSize(file) {
  return new Promise(resolve => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    v.preload = 'metadata'
    v.onloadedmetadata = () => { resolve({ w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(url) }
    v.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(url) }
    v.src = url
  })
}

const backgrounded = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export const useSocial = create((set, get) => ({
  enabled: !!supabase,
  session: undefined,
  me: null,
  friends: [],
  convs: [],
  online: {},
  stage: 'open',
  chat: null,
  messages: {},
  sending: false,
  uploading: false,
  game: null,
  typing: {}, // convId -> { userId: { name, at } }
  reads: {},  // convId -> { userId: last read timestamp }
  beta: { access: false, admin: false }, // "In Entwicklung" unlocked? admin (may unlock others)?
  views: {},
  call: null,     // convId of the call you are in (others in that chat see it and can join)
  callSince: 0,
  watching: [], // chats someone is looking at right now (overlay windows): new messages there count as read
  status: load('status', 'online'),
  idle: false,   // no input for a while: shown as "afk" while the status is "online"
  tracks: true,  // false in the overlays: only the launcher window tells the others you're online
  /** Set by the app: sounds for new messages, requests, friends coming online. */
  onEvent: null,

  // ------------------------------------------------------------------ lifecycle
  async init() {
    if (!supabase) { set({ session: null }); return }
    if (inited) return
    inited = true
    const { data } = await supabase.auth.getSession()
    get()._setSession(data.session ?? null)
    supabase.auth.onAuthStateChange((_event, s) => {
      if ((s?.user?.id || null) !== (get().session?.user?.id || null)) get()._setSession(s ?? null)
      else set({ session: s ?? null })
    })
  },

  _setSession(session) {
    get()._stop()
    set({ session, me: null, friends: [], convs: [], online: {}, chat: null, views: {}, messages: {}, beta: { access: false, admin: false } })
    if (session) get()._start()
  },

  async _start() {
    await Promise.all([get().loadMe(), get().loadFriends(), get().loadConvs()])
    if (get().status !== 'offline') get()._connect()

    timers.push(setInterval(() => get().loadMe(), PROFILE_REFRESH))
    const onFocus = () => {
      get().loadFriends()
      if (get().chat) get()._markRead(get().chat.convId)
      else get().loadConvs()
    }
    window.addEventListener('focus', onFocus)
    timers.push(() => window.removeEventListener('focus', onFocus))
  },

  /** Live updates: friendships, new messages, who is online. */
  _connect() {
    if (channels.length || !get().session) return
    const uid = get().session.user.id
    connectedAt = Date.now()
    const db = supabase
      .channel(`social-db-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'social_friendships' }, p => get()._onFriendship(p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'social_messages' }, p => get()._onMessage(p.new))
      .subscribe()
    channels.push(db)

    presence = supabase.channel('auch-online', { config: { presence: { key: uid } } })
    presence
      .on('presence', { event: 'sync' }, () => {
        const prev = get().online
        const online = {}
        for (const [id, metas] of Object.entries(presence.presenceState())) online[id] = metas.find(m => m.game) || metas[metas.length - 1] || {}
        set({ online })
        get()._presenceEvents(prev, online)
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') get()._track() })
    channels.push(presence)
    // chats that were open before going offline
    for (const id of new Set([get().chat?.convId, ...Object.keys(get().views)].filter(Boolean))) get()._joinConv(id)
  },

  _disconnect() {
    get()._leaveConv()
    for (const c of channels) supabase?.removeChannel(c)
    channels = []
    presence = null
  },

  _stop() {
    get()._disconnect()
    for (const t of timers) typeof t === 'function' ? t() : clearInterval(t)
    timers = []
  },

  _track() {
    if (!presence || !get().tracks) return
    const { me, game, status, idle } = get()
    if (status === 'invisible' || status === 'offline') { presence.untrack(); return }
    const shown = status === 'online' && idle ? 'afk' : status
    const { call, callSince } = get()
    presence.track({ name: me?.player_name || '', avatar: me?.avatar_url || null, game: game || null, status: shown, since: Date.now(), call: call || null, callSince: call ? callSince : 0 })
  },

  /** The call you are in (useCall): goes into your presence. */
  setCall(convId) {
    if (get().call === convId) return
    set({ call: convId || null, callSince: convId ? Date.now() : 0 })
    get()._track()
  },

  /** Friends coming online or starting a game (not right after connecting, not for a quick reconnect). */
  _presenceEvents(prev, next) {
    const now = Date.now()
    const uid = get().session?.user?.id
    for (const id of Object.keys(prev)) if (!next[id]) leftAt[id] = now
    if (now - connectedAt < 8000 || !get().onEvent) return
    const friend = id => get().friends.find(f => f.user_id === id && f.relation === 'friend')
    for (const [id, p] of Object.entries(next)) {
      const f = id !== uid && friend(id)
      if (!f) continue
      if (!prev[id] && now - (leftAt[id] || 0) > 120000) get().onEvent('online', { userId: id, name: f.player_name })
      else if (prev[id] && p.game && p.game !== prev[id].game) get().onEvent('playing', { userId: id, name: f.player_name, game: p.game })
    }
  },

  /**
   * Own status. invisible: you see everyone, nobody sees you. offline: no live
   * connection at all (no new messages until you come back).
   */
  setStatus(status) {
    save('status', status)
    get()._applyStatus(status)
  },

  _applyStatus(status) {
    const was = get().status
    set({ status })
    if (!get().session) return
    if (status === 'offline') { get()._disconnect(); set({ online: {} }); return }
    if (was === 'offline' || !channels.length) { get()._connect(); get().loadFriends(); get().loadConvs(); return }
    get()._track()
  },

  /** No input for a while (set by the app, see the auto-afk setting). */
  setIdle(idle) {
    if (get().idle === idle) return
    set({ idle })
    get()._track()
  },

  /** Called by the launcher whenever the running game changes. */
  setGame(game) {
    if (get().game === game) return
    set({ game })
    get()._track()
  },

  // ------------------------------------------------------------------ data
  async loadMe() {
    const { data, error } = await supabase.rpc('social_me')
    if (!error && data?.[0]) { set({ me: data[0] }); get()._track() }
  },

  async loadFriends() {
    const { data, error } = await supabase.rpc('social_friends')
    if (!error) set({ friends: data || [] })
  },

  async loadConvs() {
    const { data, error } = await supabase.rpc('social_conversations_list')
    if (!error) set({ convs: data || [] })
  },

  unreadFor(friendId) {
    return get().convs.find(c => c.kind === 'direct' && c.other_id === friendId)?.unread || 0
  },

  _onFriendship(p) {
    const uid = get().session?.user?.id
    get().loadFriends().then(() => {
      const who = () => get().friends.find(f => f.request_id === p.new.id)?.player_name || 'Jemand'
      if (p.eventType === 'INSERT' && p.new?.addressee === uid) {
        get().onEvent?.('request', { name: who() })
        if (backgrounded() && get().notify) desktop.notify(`${who()} will dich adden`, 'Im Launcher annehmen')
      }
      if (p.eventType === 'UPDATE' && p.new?.status === 'accepted' && p.new?.requester === uid) {
        get().onEvent?.('accepted', { name: who() })
        if (backgrounded() && get().notify) desktop.notify(`${who()} hat angenommen`, 'Ihr seid jetzt befreundet')
      }
    })
  },

  _onMessage(m) {
    const uid = get().session?.user?.id
    const list = get().messages[m.conversation_id]
    if (list && !list.some(x => x.id === m.id)) {
      set({ messages: { ...get().messages, [m.conversation_id]: [...list, m] } })
    }
    const open = get().chat?.convId === m.conversation_id
    const seen = (open && !backgrounded()) || get().watching.includes(m.conversation_id)
    if (m.sender !== uid) {
      const t = get().typing[m.conversation_id]
      if (t?.[m.sender]) { const { [m.sender]: _, ...rest } = t; set({ typing: { ...get().typing, [m.conversation_id]: rest } }) }
      if (seen) get()._markRead(m.conversation_id)
      else get().loadConvs()
      if (m.kind === 'system' && (open || get().views[m.conversation_id])) get()._loadMembers(m.conversation_id)
      if (m.kind !== 'system') {
        const kind = get().convs.find(c => c.id === m.conversation_id)?.kind
        get().onEvent?.(m.kind === 'invite' ? 'invite' : kind === 'group' ? 'group' : 'dm', { message: m, seen })
      }
      if (!seen && get().notify && m.kind !== 'system') {
        const conv = get().convs.find(c => c.id === m.conversation_id)
        const who = get().nameOf(m.sender) || 'Neue Nachricht'
        const text = m.body.length > 120 ? m.body.slice(0, 117) + '…' : m.body
        if (conv?.kind === 'group') desktop.notify(conv.title || 'Gruppe', `${who}: ${text}`)
        else desktop.notify(who, text)
      }
    }
  },

  /** Set by the app from the launcher's notification setting. */
  notify: true,

  // ------------------------------------------------------------------ sidebar + chat
  setStage(stage) {
    save('sidebar', stage)
    if (stage === 'rail') get().closeChat()
    set({ stage })
  },

  async openChat(friend) {
    set({ stage: 'open' })
    save('sidebar', 'open')
    const { data: convId, error } = await supabase.rpc('social_open_direct', { other: friend.user_id })
    if (error) throw new Error(germanError(error))
    if (get().chat?.convId !== convId) get().closeChat()
    set({ chat: { convId, kind: 'direct', friend } })
    await get()._loadMessages(convId)
  },

  async openGroup(conv) {
    if (get().chat?.convId !== conv.id) get().closeChat()
    set({ stage: 'open', chat: { convId: conv.id, kind: 'group', title: conv.title, members: null } })
    save('sidebar', 'open')
    get()._loadMembers(conv.id)
    await get()._loadMessages(conv.id)
  },

  /**
   * Opens a chat next to the others (overlay windows), without touching the
   * sidebar: a conversation from `convs`, or a friend you haven't written with yet.
   */
  async openView({ conv, friend }) {
    let convId = conv?.id
    if (!convId) {
      const { data, error } = await supabase.rpc('social_open_direct', { other: friend.user_id })
      if (error) throw new Error(germanError(error))
      convId = data
    }
    const c = conv?.kind ? conv : get().convs.find(x => x.id === convId) || conv
    let view
    if (c?.kind === 'group') {
      view = { convId, kind: 'group', title: c.title, members: get().views[convId]?.members || null }
    } else {
      const otherId = friend?.user_id || c?.other_id
      const f = get().friends.find(x => x.user_id === otherId) || friend || { user_id: otherId, player_name: c?.title || '?' }
      view = { convId, kind: 'direct', friend: f }
    }
    set({ views: { ...get().views, [convId]: view } })
    if (view.kind === 'group') get()._loadMembers(convId)
    if (get().messages[convId]) { get()._joinConv(convId); await get()._markRead(convId) }
    else await get()._loadMessages(convId)
    return convId
  },

  closeView(convId) {
    const { [convId]: _, ...views } = get().views
    set({ views })
    if (get().chat?.convId !== convId) get()._leaveConv(convId)
  },

  async _loadMembers(convId) {
    const { data } = await supabase.rpc('social_members_of', { conv: convId })
    const chat = get().chat
    if (chat?.convId === convId) set({ chat: { ...chat, members: data || [] } })
    const v = get().views[convId]
    if (v) set({ views: { ...get().views, [convId]: { ...v, members: data || [] } } })
  },

  async _loadMessages(convId) {
    const { data } = await supabase
      .from('social_messages')
      .select('id, conversation_id, sender, kind, body, payload, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(80)
    set({ messages: { ...get().messages, [convId]: (data || []).reverse() } })
    get()._joinConv(convId)
    await get()._markRead(convId)
  },

  closeChat() {
    const id = get().chat?.convId
    if (id && !get().views[id]) get()._leaveConv(id)
    set({ chat: null })
  },

  /** Live channel of an open chat: who is typing, who has read up to where. */
  _joinConv(convId) {
    if (convChannels.has(convId) || !channels.length) return
    const uid = get().session.user.id
    const ch = supabase
      .channel(`conv-${convId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.user || payload.user === uid) return
        const t = { ...(get().typing[convId] || {}), [payload.user]: { name: payload.name, at: Date.now() } }
        set({ typing: { ...get().typing, [convId]: t } })
      })
      .on('broadcast', { event: 'read' }, ({ payload }) => {
        if (payload?.user && payload.at) get()._setRead(convId, payload.user, payload.at)
      })
      .subscribe()
    convChannels.set(convId, ch)
    supabase.from('social_members').select('user_id, last_read_at').eq('conversation_id', convId).then(({ data }) => {
      if (data) set({ reads: { ...get().reads, [convId]: { ...Object.fromEntries(data.map(r => [r.user_id, r.last_read_at])), ...(get().reads[convId] || {}) } } })
    })
  },

  /** Leaves one chat's live channel, or all of them. */
  _leaveConv(convId) {
    for (const [id, ch] of [...convChannels]) {
      if (convId && id !== convId) continue
      supabase?.removeChannel(ch)
      convChannels.delete(id)
    }
  },

  _setRead(convId, user, at) {
    const prev = get().reads[convId]?.[user]
    if (prev && new Date(prev) >= new Date(at)) return
    set({ reads: { ...get().reads, [convId]: { ...(get().reads[convId] || {}), [user]: at } } })
  },

  async _markRead(convId) {
    await supabase.rpc('social_mark_read', { conv: convId })
    const list = get().messages[convId]
    const at = list?.length ? list[list.length - 1].created_at : new Date().toISOString()
    convChannels.get(convId)?.send({ type: 'broadcast', event: 'read', payload: { user: get().session?.user?.id, at } })
    get().loadConvs()
  },

  /** Called while typing; tells the others at most every 2.5 s. */
  typingPing(convId = get().chat?.convId) {
    const now = Date.now()
    const ch = convChannels.get(convId)
    if (!ch || now - (lastTypingPing.get(convId) || 0) < 2500) return
    lastTypingPing.set(convId, now)
    ch.send({ type: 'broadcast', event: 'typing', payload: { user: get().session?.user?.id, name: get().me?.player_name || '' } })
  },

  /** Names of the people typing in a chat right now. */
  typingIn(convId) {
    const t = get().typing[convId] || {}
    return Object.values(t).filter(x => Date.now() - x.at < TYPING_MS).map(x => x.name)
  },

  /** Upload a picture or video into a chat (default: the open one) and post it. */
  async sendMedia(file, convId = get().chat?.convId) {
    const chat = convId ? { convId } : null
    if (!chat || !file) return
    const uid = get().session.user.id
    let blob = file, w = 0, h = 0, type = 'image'
    if (/^video\/(mp4|webm)$/.test(file.type)) {
      if (file.size > VIDEO_MAX) throw new Error('Videos gehen bis 15 MB. Für längere einfach einen Link schicken.')
      type = 'video'
      ;({ w, h } = await videoSize(file))
    } else if (file.type === 'image/gif') {
      if (file.size > GIF_MAX) throw new Error('GIFs gehen bis 8 MB.')
      const bmp = await createImageBitmap(file).catch(() => null)
      if (bmp) { w = bmp.width; h = bmp.height; bmp.close?.() }
    } else if (/^image\//.test(file.type)) {
      ;({ blob, w, h } = await shrink(file))
    } else {
      throw new Error('Geht nur mit Bildern und Videos (MP4, WebM).')
    }
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' }[blob.type] || 'bin'
    const path = `${chat.convId}/${uid}/${Date.now()}.${ext}`
    set({ uploading: true })
    try {
      const { error } = await supabase.storage.from('chat').upload(path, blob, { contentType: blob.type, upsert: false })
      if (error) {
        throw new Error(/bucket not found|row-level|policy|unauthorized|403|404/i.test(error.message || '')
          ? 'Bilder im Chat sind noch nicht freigeschaltet.'
          : germanError(error))
      }
      await get().send(type === 'video' ? 'Video' : 'Bild', { kind: 'media', payload: { path, type, w, h, size: blob.size } }, convId)
    } finally {
      set({ uploading: false })
    }
  },

  /** Short-lived link to a chat file (members only, so no public URL). */
  async mediaUrl(path) {
    const hit = signed.get(path)
    if (hit && hit.until > Date.now()) return hit.url
    const { data, error } = await supabase.storage.from('chat').createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) return null
    signed.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 })
    return data.signedUrl
  },

  /** Invite the chat to play a game together. */
  async sendInvite(game, convId) {
    await get().send(`Lust auf ${game.name}?`, { kind: 'invite', payload: { game: game.id, name: game.name, art: game.artUrl || null, accent: game.accent || null } }, convId)
  },

  async createGroup(name, memberIds) {
    const { data: convId, error } = await supabase.rpc('social_create_group', { group_name: name.trim().slice(0, 60), member_ids: memberIds })
    if (error) throw new Error(germanError(error))
    await get().loadConvs()
    const conv = get().convs.find(c => c.id === convId) || { id: convId, title: name.trim() }
    await get().openGroup(conv)
  },

  async addToGroup(convId, userId) {
    const { error } = await supabase.rpc('social_add_to_group', { conv: convId, member_id: userId })
    if (error) throw new Error(germanError(error))
    get()._loadMembers(convId)
    get().loadConvs()
  },

  async leaveGroup(convId) {
    const { error } = await supabase.rpc('social_leave', { conv: convId })
    if (error) throw new Error(germanError(error))
    const messages = { ...get().messages }
    delete messages[convId]
    const { [convId]: _, ...views } = get().views
    get()._leaveConv(convId)
    set({ messages, views, ...(get().chat?.convId === convId ? { chat: null } : {}) })
    await get().loadConvs()
  },

  /** Name of whoever sent a message: a friend, a group member or yourself. */
  nameOf(userId) {
    const s = get()
    if (userId === s.session?.user?.id) return s.me?.player_name || 'Du'
    return s.friends.find(f => f.user_id === userId)?.player_name
      || s.chat?.members?.find(m => m.user_id === userId)?.player_name
      || Object.values(s.views).flatMap(v => v.members || []).find(m => m.user_id === userId)?.player_name
      || null
  },

  async send(body, extra = {}, convId = get().chat?.convId) {
    const chat = convId ? { convId } : null
    const text = body.trim()
    if (!chat || !text) return
    set({ sending: true })
    const { data, error } = await supabase
      .from('social_messages')
      .insert({ conversation_id: chat.convId, sender: get().session.user.id, body: text.slice(0, 2000), kind: extra.kind || 'text', payload: extra.payload || null })
      .select('id, conversation_id, sender, kind, body, payload, created_at')
      .single()
    set({ sending: false })
    if (error) throw new Error(germanError(error))
    lastTypingPing.delete(chat.convId)
    get()._onMessage(data)
    get().loadConvs()
  },

  // ------------------------------------------------------------------ friends
  async respond(requestId, accept) {
    const { error } = await supabase.rpc('social_respond', { request_id: requestId, accept })
    if (error) throw new Error(germanError(error))
    await get().loadFriends()
  },
  async addByCode(code) {
    const { data, error } = await supabase.rpc('social_request_by_code', { code })
    if (error) throw new Error(germanError(error))
    await get().loadFriends()
    return data
  },
  async request(target) {
    const { data, error } = await supabase.rpc('social_request', { target })
    if (error) throw new Error(germanError(error))
    await get().loadFriends()
    return data
  },
  async remove(other) {
    const { error } = await supabase.rpc('social_remove', { other })
    if (error) throw new Error(germanError(error))
    if (get().chat?.friend?.user_id === other) set({ chat: null })
    await get().loadFriends()
  },
  async search(q) {
    const { data, error } = await supabase.rpc('social_search', { q })
    if (error) throw new Error(germanError(error))
    return data || []
  },

  // ------------------------------------------------------------------ beta ("In Entwicklung")
  /**
   * Whether this account is unlocked, and the beta games it may see (none
   * without access; also none while sql/beta.sql isn't set up). Covers come
   * as signed links that last a day.
   */
  async loadBeta() {
    if (!supabase || !get().session) { set({ beta: { access: false, admin: false } }); return [] }
    const { data: me, error } = await supabase.rpc('beta_me')
    const row = !error && Array.isArray(me) ? me[0] : null
    const beta = { access: !!row?.access, admin: !!row?.admin }
    set({ beta })
    if (!beta.access) return []
    const { data } = await supabase.from('beta_games').select('id, entry, version, notes, signature, setup_path, size, pub_date')
    const rows = data || []
    const paths = rows.map(r => r.entry?.artPath).filter(Boolean)
    if (paths.length) {
      const { data: urls } = await supabase.storage.from('beta').createSignedUrls(paths, 86400)
      const byPath = Object.fromEntries((urls || []).filter(u => u.signedUrl).map(u => [u.path, u.signedUrl]))
      for (const r of rows) r.artUrl = byPath[r.entry?.artPath] || null
    }
    return rows
  },

  /** Admins: what they see about someone ({ is_admin, beta, member_since }). */
  async adminInfo(userId) {
    const { data, error } = await supabase.rpc('social_admin_info', { target: userId })
    if (error) throw new Error(/function|does not exist|schema cache/i.test(error.message || '') ? 'Admin-Werkzeuge sind noch nicht freigeschaltet.' : germanError(error))
    return data?.[0] || null
  },
  async adminSet(userId, makeAdmin) {
    const { error } = await supabase.rpc('social_admin_set', { target: userId, make_admin: makeAdmin })
    if (error) throw new Error(error.message?.startsWith('Dich selbst') || error.message?.startsWith('Nur') ? error.message : germanError(error))
  },
  async adminClear(userId, what) {
    const { error } = await supabase.rpc('social_admin_clear', { target: userId, what })
    if (error) throw new Error(germanError(error))
    await get().loadFriends()
  },

  /** Short-lived download link for a beta installer (testers only). */
  async betaUrl(path) {
    const { data, error } = await supabase.storage.from('beta').createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) throw new Error('Kein Zugriff auf die Beta. Frag mal nach, ob du noch freigeschaltet bist.')
    return data.signedUrl
  },

  /** Admins: unlock or lock someone for "In Entwicklung". */
  async setBetaAccess(userId, allow) {
    const { error } = await supabase.rpc('beta_set_access', { target: userId, allow })
    if (error) throw new Error(germanError(error))
  },

  /** Admins: everyone who is unlocked. */
  async betaTesters() {
    const { data, error } = await supabase.rpc('beta_testers')
    if (error) throw new Error(germanError(error))
    return data || []
  },

  // ------------------------------------------------------------------ account
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(germanError(error))
  },
  async signUp(name, email, password) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { player_name: name.trim() }, emailRedirectTo: WELCOME_URL },
    })
    if (error) throw new Error(germanError(error))
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error(germanError('already registered'))
  },
  async signOut() {
    await supabase.auth.signOut()
  },

  async sendFeedback({ kind, area, text, version }) {
    const s = get().session
    if (!s) throw new Error('Kurz einloggen, dann klappt das Senden.')
    const { error } = await supabase.from('bug_reports').insert({
      user_id: s.user.id,
      user_email: s.user.email,
      description: `${kind === 'idea' ? 'Vorschlag' : 'Bug'} · ${area}: ${text.trim()}`,
      app_version: version || null,
      app_state: { tool: 'launcher', kind: kind === 'idea' ? 'vorschlag' : 'bug', area, platform: navigator.platform, screenSize: `${window.innerWidth}x${window.innerHeight}`, timestamp: new Date().toISOString() },
      priority: kind === 'idea' ? 'low' : 'medium',
      status: 'open',
    })
    if (error) throw new Error(germanError(error))
  },
}))
