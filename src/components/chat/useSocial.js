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
  game: null,

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
    set({ session, me: null, friends: [], convs: [], online: {}, chat: null, messages: {} })
    if (session) get()._start()
  },

  async _start() {
    const uid = get().session.user.id
    await Promise.all([get().loadMe(), get().loadFriends(), get().loadConvs()])

    const db = supabase
      .channel(`social-db-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'social_friendships' }, p => get()._onFriendship(p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'social_messages' }, p => get()._onMessage(p.new))
      .subscribe()
    channels.push(db)

    presence = supabase.channel('auch-online', { config: { presence: { key: uid } } })
    presence
      .on('presence', { event: 'sync' }, () => {
        const online = {}
        for (const [id, metas] of Object.entries(presence.presenceState())) online[id] = metas[metas.length - 1] || {}
        set({ online })
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') get()._track() })
    channels.push(presence)

    timers.push(setInterval(() => get().loadMe(), PROFILE_REFRESH))
    const onFocus = () => { get().loadFriends(); get().loadConvs() }
    window.addEventListener('focus', onFocus)
    timers.push(() => window.removeEventListener('focus', onFocus))
  },

  _stop() {
    for (const c of channels) supabase?.removeChannel(c)
    channels = []
    presence = null
    for (const t of timers) typeof t === 'function' ? t() : clearInterval(t)
    timers = []
  },

  _track() {
    const { me, game } = get()
    presence?.track({ name: me?.player_name || '', avatar: me?.avatar_url || null, game: game || null, since: Date.now() })
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
      if (p.eventType === 'INSERT' && p.new?.addressee === uid && backgrounded() && get().notify) {
        const who = get().friends.find(f => f.request_id === p.new.id)?.player_name || 'Jemand'
        desktop.notify(`${who} will dich adden`, 'Im Launcher annehmen')
      }
      if (p.eventType === 'UPDATE' && p.new?.status === 'accepted' && p.new?.requester === uid && backgrounded() && get().notify) {
        const who = get().friends.find(f => f.request_id === p.new.id)?.player_name || 'Jemand'
        desktop.notify(`${who} hat angenommen`, 'Ihr seid jetzt befreundet')
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
    if (m.sender !== uid) {
      if (open && !backgrounded()) supabase.rpc('social_mark_read', { conv: m.conversation_id }).then(() => get().loadConvs())
      else get().loadConvs()
      if (open && get().chat.kind === 'group' && m.kind === 'system') get()._loadMembers(m.conversation_id)
      if ((!open || backgrounded()) && get().notify && m.kind !== 'system') {
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
    set({ stage, ...(stage === 'rail' ? { chat: null } : {}) })
  },

  async openChat(friend) {
    set({ stage: 'open' })
    save('sidebar', 'open')
    const { data: convId, error } = await supabase.rpc('social_open_direct', { other: friend.user_id })
    if (error) throw new Error(germanError(error))
    set({ chat: { convId, kind: 'direct', friend } })
    await get()._loadMessages(convId)
  },

  async openGroup(conv) {
    set({ stage: 'open', chat: { convId: conv.id, kind: 'group', title: conv.title, members: null } })
    save('sidebar', 'open')
    get()._loadMembers(conv.id)
    await get()._loadMessages(conv.id)
  },

  async _loadMembers(convId) {
    const { data } = await supabase.rpc('social_members_of', { conv: convId })
    const chat = get().chat
    if (chat?.convId === convId) set({ chat: { ...chat, members: data || [] } })
  },

  async _loadMessages(convId) {
    const { data } = await supabase
      .from('social_messages')
      .select('id, conversation_id, sender, kind, body, payload, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(80)
    set({ messages: { ...get().messages, [convId]: (data || []).reverse() } })
    await supabase.rpc('social_mark_read', { conv: convId })
    get().loadConvs()
  },

  closeChat: () => set({ chat: null }),

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
    set({ messages, ...(get().chat?.convId === convId ? { chat: null } : {}) })
    await get().loadConvs()
  },

  /** Name of whoever sent a message: a friend, a group member or yourself. */
  nameOf(userId) {
    const s = get()
    if (userId === s.session?.user?.id) return s.me?.player_name || 'Du'
    return s.friends.find(f => f.user_id === userId)?.player_name
      || s.chat?.members?.find(m => m.user_id === userId)?.player_name
      || null
  },

  async send(body) {
    const chat = get().chat
    const text = body.trim()
    if (!chat || !text) return
    set({ sending: true })
    const { data, error } = await supabase
      .from('social_messages')
      .insert({ conversation_id: chat.convId, sender: get().session.user.id, body: text.slice(0, 2000) })
      .select('id, conversation_id, sender, kind, body, payload, created_at')
      .single()
    set({ sending: false })
    if (error) throw new Error(germanError(error))
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
