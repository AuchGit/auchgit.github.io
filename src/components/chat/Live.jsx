// Going live (store/useLive): start it, see who's live, watch / listen, the viewer chat.
// The same parts in the launcher window (LiveDock), the overlay (window "live") and on
// the website.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera, ChevronDown, Eye, Headphones, Loader2, Mic, MicOff, Monitor, Radio, Send, VideoOff, Volume2, VolumeX, X } from 'lucide-react'
import { programOk, useLive } from './useLive'
import { useSocial } from './useSocial'
import { PersonAvatar } from './Person'

// Website copy of the launcher's components/live/Live.jsx.
const calls = { sources: async () => [] }
// small settings in this browser (same keys as the launcher)
const PREFIX = 'auch.'
const load = (k, d) => { try { const r = localStorage.getItem(PREFIX + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch { /* blocked */ } }

// where watching shows up (the overlay opens its window, the launcher / website the dock)
let opener = () => useLive.setState({ dockOpen: true })
export const setLiveOpener = fn => { opener = fn }
export function watchLive(host, want) {
  useLive.getState().watch(host, want)
  opener()
}

function useNow(ms = 1000) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), ms); return () => clearInterval(t) }, [ms])
}
const clock = since => {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}
const what = l => (l?.video && l?.audio ? 'Bild und Ton' : l?.video ? 'Bild' : 'Ton')

export function LivePill({ className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-md bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white ${className}`}><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live</span>
}

function Video({ stream, className = '' }) {
  const ref = useRef(null)
  useEffect(() => { const el = ref.current; if (el && el.srcObject !== stream) el.srcObject = stream || null }, [stream])
  return <video ref={ref} autoPlay playsInline muted onDoubleClick={e => { const el = e.currentTarget; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else el.requestFullscreen?.().catch(() => {}) }} className={className} />
}

const btn = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 transition hover:bg-white/[0.08] hover:text-white'

// ------------------------------------------------------------------ start
/** Pick picture and sound, then go. `convId`: also post a card into that chat. */
export function GoLive({ convId = null, onDone }) {
  const last = load('liveLast', {})
  const canScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  const firstVideo = last.video === 'cam' ? 'cam' : last.video === null ? null : canScreen ? 'screen' : null
  const [video, setVideo] = useState(firstVideo)
  const [prog, setProg] = useState(programOk ? (last.prog === undefined ? 0 : last.prog) : null)
  const [mic, setMic] = useState(!!last.mic)
  const [title, setTitle] = useState('')
  const [announce, setAnnounce] = useState(last.announce !== false)
  const [sources, setSources] = useState([])
  const starting = useLive(s => s.starting)
  const error = useLive(s => s.error)
  const mirror = useLive(s => s.mirror)
  useEffect(() => { if (programOk) calls.sources().then(setSources).catch(() => {}) }, [])
  const progSrc = prog == null ? null : prog === 0 ? { pid: 0, name: 'Alles außer dem Launcher' } : (s => (s ? { pid: s.pid, name: s.name } : null))(sources.find(x => x.pid === prog))
  const ok = !!(video || progSrc || mic)
  async function go() {
    save('liveLast', { video, prog: prog != null && prog !== 0 ? 0 : prog, mic, announce })
    await useLive.getState().start({ video, program: progSrc, mic, title, announce, convId })
    if (mirror || useLive.getState().live) onDone?.()
  }
  const choice = (val, Icon, label) => (
    <button type="button" key={label} onClick={() => setVideo(val)}
      className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[12px] transition ${video === val ? 'border-rose-400/60 bg-rose-500/15 text-white' : 'border-white/[0.08] bg-white/[0.03] text-ink-300 hover:text-white'}`}>
      <Icon size={14} /> {label}
    </button>
  )
  const field = 'h-8 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[12.5px] text-white outline-none placeholder:text-ink-500 focus:border-brand-400'
  return (
    <div className="space-y-2.5 p-1.5">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold"><Radio size={16} className="text-rose-400" /> Live gehen</div>
      <p className="text-[11.5px] leading-snug text-ink-400">Deine Freunde sehen das in der Freundesliste und kommen rein, wenn sie wollen. Es klingelt nicht.</p>
      <div>
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-500">Bild</div>
        <div className="flex gap-1.5">
          {choice(null, VideoOff, 'Keins')}
          {canScreen && choice('screen', Monitor, 'Bildschirm')}
          {choice('cam', Camera, 'Kamera')}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-500">Ton</div>
        {programOk ? (
          <select value={prog == null ? '' : String(prog)} onChange={e => setProg(e.target.value === '' ? null : Number(e.target.value))} className={`${field} bg-ink-900`}>
            <option value="" className="bg-ink-800">Kein Programm-Sound</option>
            <option value="0" className="bg-ink-800">Alles außer dem Launcher</option>
            {sources.map(s => <option key={s.pid} value={String(s.pid)} className="bg-ink-800">{s.name}{s.active ? '' : ' (still)'}</option>)}
          </select>
        ) : video === 'screen' && <p className="text-[11.5px] text-ink-400">Im Auswahlfenster „Ton teilen“ anhaken, dann hören die anderen mit.</p>}
        <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-200">
          <input type="checkbox" checked={mic} onChange={e => setMic(e.target.checked)} className="h-4 w-4 accent-rose-500" /> Mikro an
        </label>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="Was läuft? (geht auch ohne)" className={field}
        onKeyDown={e => { if (e.key === 'Enter' && ok) { e.preventDefault(); go() } }} />
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-300">
        <input type="checkbox" checked={announce} onChange={e => setAnnounce(e.target.checked)} className="h-4 w-4 accent-brand-500" /> Freunden Bescheid sagen (Benachrichtigung)
      </label>
      {error && <p className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11.5px] text-rose-200">{error}</p>}
      <button type="button" onClick={go} disabled={!ok || starting}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-rose-500 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
        {starting ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />} {ok ? 'Live gehen' : 'Wähl Bild oder Ton'}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ chat
function LiveChat({ host = false }) {
  const chat = useLive(s => (host ? s.chat : s.wchat))
  const uid = useSocial(s => s.session?.user?.id)
  const [text, setText] = useState('')
  const box = useRef(null)
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [chat.length])
  const send = () => {
    if (!text.trim()) return
    const s = useLive.getState()
    if (host) s.hostSay(text); else s.say(text)
    setText('')
  }
  return (
    <div className="flex min-h-[110px] flex-1 flex-col border-t border-white/[0.06]">
      <div ref={box} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-[12.5px] leading-snug">
        {!chat.length && <p className="text-ink-500">Chat für alle, die dabei sind. Wird nicht gespeichert.</p>}
        {chat.map(m => (
          <p key={m.id} className="break-words">
            <b className={m.from === uid ? 'text-brand-300' : 'text-rose-300'}>{m.name}</b> <span className="text-ink-200">{m.text}</span>
          </p>
        ))}
      </div>
      <form className="flex items-center gap-1.5 border-t border-white/[0.06] p-2" onSubmit={e => { e.preventDefault(); send() }}>
        <input data-keys value={text} onChange={e => setText(e.target.value)} maxLength={300} placeholder="Schreiben"
          className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[12.5px] text-white outline-none placeholder:text-ink-500 focus:border-brand-400" />
        <button type="submit" disabled={!text.trim()} title="Senden" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-white disabled:bg-white/[0.06] disabled:text-ink-500"><Send size={14} /></button>
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ host / viewer panels
export function LiveHost() {
  useNow()
  const live = useLive(s => s.live)
  const viewers = useLive(s => s.viewers)
  const preview = useLive(s => s.preview)
  const mirror = useLive(s => s.mirror)
  const error = useLive(s => s.error)
  const [level, setLevel] = useState(() => load('settings', {}).liveProgramVolume ?? 100)
  const [sure, setSure] = useState(false)
  if (!live) return null
  const list = Object.values(viewers)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <LivePill />
        <span className="text-[12px] tabular-nums text-ink-300">{clock(live.since)}</span>
        <span className="flex items-center gap-1 text-[12px] text-ink-400" title={list.map(v => v.name).join(', ') || 'Noch niemand'}><Eye size={13} /> {list.length}</span>
        <div className="flex-1" />
        <button onClick={() => useLive.getState().toggleMic()} title={live.mic ? 'Mikro aus' : 'Mikro an'} className={`${btn} ${live.mic ? '' : 'text-rose-300'}`}>{live.mic ? <Mic size={15} /> : <MicOff size={15} />}</button>
        <button onClick={() => { if (sure) useLive.getState().stop(); else { setSure(true); setTimeout(() => setSure(false), 3000) } }}
          className={`h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold ${sure ? 'bg-rose-500 text-white' : 'bg-white/[0.07] text-rose-200 hover:bg-rose-500/20'}`}>{sure ? 'Wirklich?' : 'Beenden'}</button>
      </div>
      {preview && !mirror && <Video stream={preview} className="aspect-video w-full shrink-0 bg-black object-contain" />}
      {live.title && <div className="truncate px-3 pt-1.5 text-[12.5px] font-medium">{live.title}</div>}
      <div className="px-3 pt-1 text-[11.5px] text-ink-400">
        {what(live)}{live.program ? ` · ${live.program}` : ''}{live.mic ? ' · Mikro' : ''}
      </div>
      {live.program && (
        <label className="flex items-center gap-2 px-3 pt-1.5 text-[11.5px] text-ink-400">
          Programm
          <input type="range" min={0} max={150} step={5} value={level} onChange={e => { setLevel(Number(e.target.value)); useLive.getState().setProgramLevel(Number(e.target.value)) }} className="h-1 flex-1 accent-rose-500" />
          <span className="w-9 text-right tabular-nums">{level}%</span>
        </label>
      )}
      <div className="px-3 py-1.5 text-[11.5px] text-ink-400">
        {list.length ? <>Dabei: {list.map(v => `${v.name}${v.want === 'audio' ? ' (Ton)' : ''}`).join(', ')}</> : 'Noch niemand da. Deine Freunde sehen dich oben in der Freundesliste.'}
      </div>
      {error && <p className="mx-3 rounded-lg bg-rose-500/10 px-2 py-1 text-[11.5px] text-rose-200">{error}</p>}
      <LiveChat host />
    </div>
  )
}

export function LiveWatch() {
  const w = useLive(s => s.watching)
  const stream = useLive(s => s.stream)
  const volume = useLive(s => s.volume)
  const muted = useLive(s => s.muted)
  const error = useLive(s => s.error)
  const hostLive = useSocial(s => (w ? s.online?.[w.host]?.live : null))
  const person = useSocial(s => (w ? s.friends.find(f => f.user_id === w.host) : null))
  if (!w) return null
  const showVideo = w.want === 'both' && w.video
  const connecting = w.state !== 'connected'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <PersonAvatar id={w.host} name={w.name} url={person?.avatar_url} size={26} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="truncate">{w.name}</span> <LivePill /></div>
          <div className="truncate text-[11px] text-ink-400">{hostLive?.title || w.title || what(hostLive)}</div>
        </div>
        <button onClick={() => useLive.getState().unwatch()} title="Raus" className={btn}><X size={15} /></button>
      </div>
      {showVideo
        ? <Video stream={stream} className="aspect-video w-full shrink-0 bg-black object-contain" />
        : (
          <div className="mx-3 grid h-24 shrink-0 place-items-center rounded-xl bg-white/[0.03]">
            {connecting ? <span className="flex items-center gap-2 text-[12px] text-ink-400"><Loader2 size={14} className="animate-spin" /> Verbinde …</span>
              : <span className="flex items-end gap-1">{[0, 1, 2, 3, 4].map(i => <span key={i} className="w-1.5 animate-pulse rounded-full bg-rose-400" style={{ height: 10 + ((i * 7) % 18), animationDelay: `${i * 140}ms` }} />)}</span>}
          </div>
        )}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => useLive.getState().toggleMute()} title={muted ? 'Ton an' : 'Stumm'} className={btn}>{muted || !volume ? <VolumeX size={15} className="text-rose-300" /> : <Volume2 size={15} />}</button>
        <input type="range" min={0} max={100} value={muted ? 0 : volume} onChange={e => useLive.getState().setVolume(Number(e.target.value))} className="h-1 min-w-0 flex-1 accent-rose-500" aria-label="Lautstärke" />
        {hostLive?.video && (
          <button onClick={() => useLive.getState().setWant(w.want === 'both' ? 'audio' : 'both')} title={w.want === 'both' ? 'Nur Ton (spart Daten)' : 'Mit Bild'}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[11.5px] text-ink-200 hover:bg-white/[0.1]">
            {w.want === 'both' ? <><Headphones size={13} /> Nur Ton</> : <><Eye size={13} /> Mit Bild</>}
          </button>
        )}
      </div>
      {error && <button onClick={() => useLive.getState().resume()} className="mx-3 rounded-lg bg-rose-500/10 px-2 py-1 text-left text-[11.5px] text-rose-200">{error}</button>}
      <LiveChat />
    </div>
  )
}

/** Hosting and / or watching (tabs when both), else nothing. */
export function LivePanel({ empty = null }) {
  const live = useLive(s => !!s.live)
  const watching = useLive(s => !!s.watching)
  const [tab, setTab] = useState('host')
  if (!live && !watching) return empty
  const both = live && watching
  const show = both ? tab : live ? 'host' : 'watch'
  return (
    <div className="flex h-full min-h-0 flex-col">
      {both && (
        <div className="flex gap-1 px-2 pt-2">
          {[['host', 'Du bist live'], ['watch', 'Du schaust zu']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`h-7 flex-1 rounded-md text-[11.5px] font-semibold ${show === id ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:text-white'}`}>{label}</button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">{show === 'host' ? <LiveHost /> : <LiveWatch />}</div>
    </div>
  )
}

// ------------------------------------------------------------------ who's live
/** Friends who are live right now (nothing when nobody is). */
export function LiveNow({ className = '' }) {
  const online = useSocial(s => s.online)
  const friends = useSocial(s => s.friends)
  const admins = useSocial(s => s.admins)
  const watching = useLive(s => s.watching?.host || null)
  const people = [...friends.filter(f => f.relation === 'friend'), ...(admins || []).filter(a => !friends.some(f => f.user_id === a.user_id))]
  const list = people.filter(p => online?.[p.user_id]?.live).map(p => ({ p, live: online[p.user_id].live }))
  if (!list.length) return null
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-rose-300"><Radio size={12} /> Live · {list.length}</div>
      {list.map(({ p, live }) => (
        <div key={p.user_id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-white/[0.04]">
          <PersonAvatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{p.player_name}</div>
            <div className="truncate text-[11px] text-rose-300">{live.title || what(live)}</div>
          </div>
          {watching === p.user_id ? <span className="text-[11px] font-semibold text-emerald-300">dabei</span> : (
            <>
              {live.audio && <button onClick={() => watchLive(p.user_id, 'audio')} title="Zuhören" className={btn}><Headphones size={15} /></button>}
              {live.video && <button onClick={() => watchLive(p.user_id, 'both')} title="Zuschauen" className={`${btn} text-rose-200`}><Eye size={15} /></button>}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/** In a chat with someone who is live right now. */
export function LiveBanner({ userId }) {
  const live = useSocial(s => (userId ? s.online?.[userId]?.live : null))
  const watching = useLive(s => s.watching?.host === userId)
  const name = useSocial(s => s.friends.find(f => f.user_id === userId)?.player_name || '')
  if (!live || watching) return null
  return (
    <div className="flex items-center gap-2 border-b border-rose-400/20 bg-rose-500/[0.08] px-3 py-1.5 text-[12px]">
      <LivePill />
      <span className="min-w-0 flex-1 truncate text-ink-200">{name} ist live{live.title ? `: ${live.title}` : ''}</span>
      {live.audio && <button onClick={() => watchLive(userId, 'audio')} className="flex h-7 items-center gap-1 rounded-lg bg-white/[0.07] px-2 text-[11.5px] hover:bg-white/[0.12]"><Headphones size={12} /> Zuhören</button>}
      {live.video && <button onClick={() => watchLive(userId, 'both')} className="flex h-7 items-center gap-1 rounded-lg bg-rose-500 px-2 text-[11.5px] font-semibold text-white hover:brightness-110"><Eye size={12} /> Zuschauen</button>}
    </div>
  )
}

/** "ist live" in a chat (payload.live): join while it lasts. */
export function LiveCard({ m, mine }) {
  const p = m.payload?.live || {}
  const now = useSocial(s => s.online?.[p.host]?.live)
  const on = !!now && now.since === p.since
  return (
    <div className="w-60 max-w-full rounded-2xl border border-rose-400/25 bg-rose-500/[0.07] p-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-rose-300"><Radio size={12} /> {on ? 'Live' : 'War live'}</div>
      <div className="mt-1 text-[13.5px] font-semibold">{mine ? 'Du bist live' : `${p.name || 'Jemand'} ist live`}</div>
      {p.title && <div className="text-[12px] text-ink-300">{p.title}</div>}
      {on && !mine && (
        <div className="mt-2 flex gap-1.5">
          {now.audio && <button onClick={() => watchLive(p.host, 'audio')} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.08] text-[12px] hover:bg-white/[0.12]"><Headphones size={13} /> Zuhören</button>}
          {now.video && <button onClick={() => watchLive(p.host, 'both')} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500 text-[12px] font-semibold text-white hover:brightness-110"><Eye size={13} /> Zuschauen</button>}
        </div>
      )}
      {!on && <div className="mt-1 text-[11.5px] text-ink-500">vorbei</div>}
    </div>
  )
}

// ------------------------------------------------------------------ launcher window / website
/** Bottom left while you are live or watching: small, or open with everything. */
export function LiveDock() {
  useNow(5000)
  const live = useLive(s => s.live)
  const w = useLive(s => s.watching)
  const viewers = useLive(s => Object.keys(s.viewers).length)
  const open = useLive(s => s.dockOpen)
  const invite = useLive(s => s.invite) // from a tapped "X ist live" notification
  const inviteLive = useSocial(s => (invite ? s.online?.[invite]?.live : null))
  const inviteName = useSocial(s => (invite ? s.friends.find(f => f.user_id === invite)?.player_name : '')) || 'Jemand'
  if (!live && !w && invite) {
    const go = want => { useLive.setState({ invite: null }); watchLive(invite, want) }
    return (
      <div className="fixed bottom-4 left-4 z-50 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-rose-400/25 bg-ink-900/95 p-3 shadow-lift backdrop-blur">
        <div className="flex items-center gap-2">
          <LivePill />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{inviteLive ? `${inviteName} ist live` : `${inviteName} ist gerade nicht live`}</span>
          <button onClick={() => useLive.setState({ invite: null })} title="Zu" className={btn}><X size={14} /></button>
        </div>
        {inviteLive?.title && <div className="mt-0.5 truncate text-[12px] text-ink-300">{inviteLive.title}</div>}
        {inviteLive && (
          <div className="mt-2 flex gap-1.5">
            {inviteLive.audio && <button onClick={() => go('audio')} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.08] text-[12px] hover:bg-white/[0.12]"><Headphones size={13} /> Zuhören</button>}
            {inviteLive.video && <button onClick={() => go('both')} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500 text-[12px] font-semibold text-white hover:brightness-110"><Eye size={13} /> Zuschauen</button>}
          </div>
        )}
      </div>
    )
  }
  if (!live && !w) return null
  if (!open) {
    return (
      <button onClick={() => useLive.setState({ dockOpen: true })}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-white/[0.08] bg-ink-900/95 py-1.5 pl-2 pr-3 text-[12px] shadow-lift backdrop-blur hover:bg-ink-800">
        <LivePill /> {live ? `${viewers} dabei` : w.name}
      </button>
    )
  }
  return (
    <div className="fixed bottom-4 left-4 z-50 flex h-[min(560px,calc(100dvh-6rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-lift backdrop-blur">
      <button onClick={() => useLive.setState({ dockOpen: false })} title="Klein machen" className="flex h-5 w-full shrink-0 items-center justify-center text-ink-500 hover:bg-white/[0.04] hover:text-white"><ChevronDown size={14} /></button>
      <div className="min-h-0 flex-1"><LivePanel /></div>
    </div>
  )
}
