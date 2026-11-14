// Call UI, website copy of the launcher's (components/call/Call.jsx there).
//
//   CallControls  people (who talks, volume for voice and program sound), buttons
//   CallRing      "X ruft an": join or not
//   CallDock      small panel while in a call
//   CallPage      big view with cameras and shared screens (over the chat)
import { useEffect, useRef, useState } from 'react'
import {
  AudioLines, ChevronDown, Eye, EyeOff, HeadphoneOff, Headphones, Loader2, Maximize2, Mic, MicOff, Minus, MonitorUp, Music2, Phone, PhoneOff,
  Plus, SlidersHorizontal, Square, Upload, Video, VideoOff, Volume2, X,
} from 'lucide-react'
import { SCREEN_MAX, useCall } from './useCall'
import { useSocial } from './useSocial'
import { PersonAvatar } from './Person'
import { GroupAvatar } from './ChatPanel'

// small settings in this browser (same keys as the launcher)
const PREFIX = 'auch.'
const load = (k, d) => { try { const r = localStorage.getItem(PREFIX + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch { /* blocked */ } }


const since = ts => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

function useTick(on) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => set(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

/** Round button for the call bar. */
function Btn({ on, danger, title, onClick, children, small }) {
  const size = small ? 'h-8 w-8' : 'h-9 w-9'
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`grid ${size} shrink-0 place-items-center rounded-full transition ${danger ? 'bg-rose-500 text-white hover:bg-rose-400' : on ? 'bg-white/[0.14] text-white' : 'bg-white/[0.06] text-ink-200 hover:bg-white/[0.1] hover:text-white'}`}>
      {children}
    </button>
  )
}

/** Program sound: desktop app only. */
export function ProgramPicker() { return null }

/** Screens, windows and tabs you share: add one (the system picker chooses), stop each. */
export function ScreenPicker({ onClose }) {
  const mine = useCall(s => s.myScreens) || []
  const mirror = useCall(s => s.mirror)
  const c = useCall.getState()
  return (
    <div className="w-64 rounded-xl border border-white/[0.08] bg-ink-900 p-1.5 shadow-lift" data-hit>
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">Bildschirm teilen</span>
        <button className="text-ink-500 hover:text-white" onClick={onClose}><X size={13} /></button>
      </div>
      {mine.map(x => (
        <div key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]">
          <MonitorUp size={14} className="shrink-0 text-emerald-300" />
          <span className="min-w-0 flex-1 truncate">{x.name}{x.sound ? <span className="text-ink-500"> · mit Ton</span> : null}</span>
          <button onClick={() => c.stopScreen(x.id)} title="Nicht mehr teilen" className="grid h-6 w-6 place-items-center rounded-md text-rose-300 hover:bg-rose-500/10"><X size={13} /></button>
        </div>
      ))}
      {mine.length > 0 && <div className="my-1 h-px bg-white/[0.06]" />}
      {mirror
        ? <p className="px-2 py-1.5 text-[12px] text-ink-400"></p>
        : (
          <button disabled={mine.length >= SCREEN_MAX} onClick={() => { c.shareScreen(); onClose() }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.07] disabled:opacity-40">
            <Plus size={14} className="text-brand-300" /> {mine.length ? 'Noch einen teilen' : 'Bildschirm, Fenster oder Tab'}
          </button>
        )}
      <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-ink-500">Mehrere gleichzeitig gehen (bis {SCREEN_MAX}). Ton kommt mit, wenn du ihn im Auswahlfenster anhakst.</p>
    </div>
  )
}

/** Your soundboard: play, upload, delete, how loud it goes out. Starts empty. */
export function BoardPicker({ onClose }) {
  const board = useCall(s => s.board) || []
  const level = useCall(s => s.boardLevel ?? 80)
  const playing = useCall(s => s.boardPlaying)
  const mirror = useCall(s => s.mirror)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const file = useRef(null)
  const c = useCall.getState()
  useEffect(() => { c.loadBoard?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async e => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    setBusy(true); setErr(null)
    for (const f of files) { try { await c.addBoardSound(f) } catch (x) { setErr(x.message) } }
    setBusy(false)
  }
  return (
    <div data-hit className="w-72 space-y-2 rounded-xl border border-white/[0.08] bg-ink-900 p-2.5 shadow-lift">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">Soundboard</span>
        <button className="text-ink-500 hover:text-white" onClick={onClose}><X size={13} /></button>
      </div>
      {board.length === 0
        ? <p className="px-0.5 text-[12px] leading-snug text-ink-400">Noch leer. Lade kurze Sounds hoch (MP3, OGG oder WAV, bis 3 MB), dann spielst du sie hier im Anruf ab.</p>
        : (
          <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
            {board.map(x => (
              <div key={x.id} className="group relative">
                <button onClick={() => c.playBoard(x.id)} title={x.name}
                  className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-[12px] transition ${playing === x.id ? 'bg-brand-500/30 text-white' : 'bg-white/[0.06] text-ink-100 hover:bg-white/[0.11]'}`}>
                  {x.name}
                </button>
                {!mirror && (
                  <button onClick={() => c.removeBoardSound(x.id)} title="Löschen"
                    className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded bg-black/50 text-ink-300 hover:text-rose-300 group-hover:grid"><X size={11} /></button>
                )}
              </div>
            ))}
          </div>
        )}
      {playing && (
        <button onClick={() => c.stopBoard()} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] py-1.5 text-[12px] text-ink-200 hover:text-white"><Square size={11} fill="currentColor" /> Stopp</button>
      )}
      <Slider label="Laut" Icon={Volume2} value={level} onChange={v => c.setBoardLevel(v)} />
      {mirror
        ? <p className="px-0.5 text-[11.5px] text-ink-500"></p>
        : (
          <>
            <input ref={file} type="file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.opus" multiple hidden onChange={upload} />
            <button onClick={() => file.current?.click()} disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-1.5 text-[12px] text-ink-200 hover:border-white/30 hover:text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Sound hochladen
            </button>
          </>
        )}
      {err && <p className="px-0.5 text-[11.5px] text-rose-300">{err}</p>}
      <p className="px-0.5 text-[11px] leading-snug text-ink-500">Die anderen stellen für sich ein, wie laut dein Soundboard bei ihnen ist.</p>
    </div>
  )
}

/** Quick switch: microphone, speakers, camera, both volumes, own picture. */
export function DevicePicker({ onClose }) {
  const devices = useCall(s => s.devices)
  const device = useCall(s => s.device)
  const levels = useCall(s => s.levels)
  const camera = useCall(s => s.camera)
  const selfView = useCall(s => s.selfView)
  const c = useCall.getState()
  const sel = (kind, list, label) => (
    <label className="block">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">{label}</span>
      <select value={device[kind] || ''} onChange={e => c.setDevice(kind, e.target.value)}
        className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.06] px-2 text-[12.5px] text-ink-100 outline-none">
        <option value="" className="bg-ink-800">Standard</option>
        {(list || []).map(d => <option key={d.id} value={d.id} className="bg-ink-800">{d.label}</option>)}
      </select>
    </label>
  )
  return (
    <div data-hit className="w-72 space-y-2.5 rounded-xl border border-white/[0.08] bg-ink-900 p-3 shadow-lift">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">Geräte</span>
        <button className="text-ink-500 hover:text-white" onClick={onClose}><X size={13} /></button>
      </div>
      {sel('input', devices?.input, 'Mikrofon')}
      <Slider label="Pegel" Icon={Mic} value={levels?.input ?? 100} onChange={v => c.setLevel('input', v)} />
      {sel('output', devices?.output, 'Lautsprecher / Kopfhörer')}
      <Slider label="Hören" Icon={Volume2} value={levels?.output ?? 100} onChange={v => c.setLevel('output', v)} />
      {sel('camera', devices?.camera, 'Kamera')}
      {camera && (
        <button onClick={() => c.toggleSelfView()} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[12.5px] text-ink-200 hover:text-white">
          {selfView ? <EyeOff size={14} /> : <Eye size={14} />} {selfView ? 'Eigenes Bild ausblenden' : 'Eigenes Bild zeigen'}
        </button>
      )}
    </div>
  )
}

function Slider({ label, value, onChange, Icon }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-400">
      <Icon size={12} className="shrink-0" />
      <span className="w-14 shrink-0">{label}</span>
      <input type="range" min={0} max={200} step={5} value={value} onChange={e => onChange(Number(e.target.value))} className="h-1 min-w-0 flex-1 accent-brand-500" />
      <span className="w-9 shrink-0 text-right tabular-nums">{value}%</span>
    </label>
  )
}

/** One person in the call, with their volume sliders folded out on click. */
function Member({ id, m, speaking, compact }) {
  const vol = useCall(s => s.volumes[id]) || {}
  const [open, setOpen] = useState(false)
  const set = (kind, v) => useCall.getState().setVolume(id, kind, v)
  const size = compact ? 26 : 32
  return (
    <li className="rounded-lg hover:bg-white/[0.03]">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left" title="Lautstärke">
        <span className={`rounded-full transition ${speaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-ink-900' : ''}`}>
          <PersonAvatar id={id} name={m.name || '?'} url={m.avatar} size={size} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink-100">{m.name || 'Jemand'}</span>
          {(m.stream || m.screens?.length > 0 || m.state === 'connecting' || m.state === 'failed') && (
            <span className="block truncate text-[11px] text-ink-400">
              {m.state === 'failed' ? 'Verbindung klappt nicht' : m.state === 'connecting' ? 'verbindet …' : <>teilt <span className="text-brand-300">{[m.stream, ...(m.screens || []).map(x => x.name)].filter(Boolean).join(', ')}</span></>}
            </span>
          )}
        </span>
        {m.video && <Video size={13} className="shrink-0 text-ink-400" />}
        {m.deaf ? <HeadphoneOff size={13} className="shrink-0 text-rose-300" /> : m.muted ? <MicOff size={13} className="shrink-0 text-rose-300" /> : null}
        <ChevronDown size={13} className={`shrink-0 text-ink-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-1.5 px-2 pb-2 pt-0.5">
          <Slider label="Stimme" Icon={Mic} value={vol.voice ?? 100} onChange={v => set('voice', v)} />
          <Slider label="Programm" Icon={AudioLines} value={vol.stream ?? 100} onChange={v => set('stream', v)} />
          <Slider label="Sounds" Icon={Music2} value={vol.board ?? 100} onChange={v => set('board', v)} />
        </div>
      )}
    </li>
  )
}

/** Everyone in the call and the buttons. Same in the launcher and the overlay. */
export function CallControls({ compact = false, onExpand, onMinimize }) {
  const call = useCall(s => s.call)
  const members = useCall(s => s.members)
  const speaking = useCall(s => s.speaking)
  const { muted, deaf, camera, sharing, error, joining, outgoing } = useCall()
  const myScreens = useCall(s => s.myScreens) || []
  const me = useSocial(s => s.me)
  const [picker, setPicker] = useState(false)
  const [devs, setDevs] = useState(false)
  const [scr, setScr] = useState(false)
  const [sb, setSb] = useState(false)
  const playing = useCall(s => s.boardPlaying)
  const only = which => { setDevs(which === 'devs' ? v => !v : false); setScr(which === 'share' ? v => !v : false); setSb(which === 'board' ? v => !v : false); setPicker(false) }
  useTick(!!call)
  if (!call) return null
  const ids = Object.keys(members)
  const c = useCall.getState()
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <Phone size={14} className="text-emerald-400" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{call.title}</span>
        {outgoing
          ? <span className="flex items-center gap-1 text-[11px] text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> klingelt</span>
          : <span className="text-[11px] tabular-nums text-ink-400">{since(call.since)}</span>}
        {onMinimize && <button className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-white/[0.07] hover:text-white" title="Kleiner" onClick={onMinimize}><Minus size={13} /></button>}
        {onExpand && <button className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-white/[0.07] hover:text-white" title="Groß ansehen" onClick={onExpand}><Maximize2 size={13} /></button>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        <li className="flex items-center gap-2.5 px-2 py-1.5">
          <span className={`rounded-full transition ${speaking.me ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-ink-900' : ''}`}>
            <PersonAvatar id={me?.id || ''} name={me?.player_name || 'Du'} url={me?.avatar_url} size={compact ? 26 : 32} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-ink-100">{me?.player_name || 'Du'} <span className="text-ink-500">(du)</span></span>
            {(sharing || myScreens.length > 0) && <span className="block truncate text-[11px] text-ink-400">teilt <span className="text-brand-300">{[sharing?.name, ...myScreens.map(x => x.name)].filter(Boolean).join(', ')}</span></span>}
          </span>
          {deaf ? <HeadphoneOff size={13} className="text-rose-300" /> : muted ? <MicOff size={13} className="text-rose-300" /> : null}
        </li>
        {ids.map(id => <Member key={id} id={id} m={members[id]} speaking={!!speaking[id]} compact={compact} />)}
        {!ids.length && <li className="px-2 py-2 text-[12px] text-ink-500">{joining ? 'Verbindet …' : outgoing ? (call.kind === 'direct' ? `Klingelt bei ${call.title} …` : 'Klingelt bei den anderen …') : 'Noch keiner da. Die anderen sehen den Anruf im Chat.'}</li>}
      </ul>
      {error && <div className="mx-3 mb-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11.5px] text-rose-200">{error}</div>}
      <div className="relative flex items-center justify-center gap-1.5 border-t border-white/[0.06] px-3 py-2.5">
        <Btn small={compact} on={muted} title={muted ? 'Mikro an' : 'Mikro aus'} onClick={() => c.toggleMute()}>{muted ? <MicOff size={16} className="text-rose-300" /> : <Mic size={16} />}</Btn>
        <Btn small={compact} on={deaf} title={deaf ? 'Wieder hören' : 'Nichts hören'} onClick={() => c.toggleDeaf()}>{deaf ? <HeadphoneOff size={16} className="text-rose-300" /> : <Headphones size={16} />}</Btn>
        <Btn small={compact} on={camera} title={camera ? 'Kamera aus' : 'Kamera an'} onClick={() => c.toggleCamera()}>{camera ? <Video size={16} className="text-emerald-300" /> : <VideoOff size={16} />}</Btn>
        <Btn small={compact} on={myScreens.length > 0 || !!sharing || scr} title="Bildschirm, Fenster oder Tab teilen" onClick={() => only('share')}><MonitorUp size={16} className={myScreens.length || sharing ? 'text-emerald-300' : ''} /></Btn>
        <Btn small={compact} on={sb || !!playing} title="Soundboard" onClick={() => only('board')}><Music2 size={16} className={playing ? 'text-brand-300' : ''} /></Btn>
        <Btn small={compact} on={devs} title="Geräte und Lautstärke" onClick={() => only('devs')}><SlidersHorizontal size={16} /></Btn>
        <Btn small={compact} danger title="Auflegen" onClick={() => c.leave()}><PhoneOff size={16} /></Btn>

        {devs && <div className="absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2"><DevicePicker onClose={() => setDevs(false)} /></div>}
        {scr && (
          <div className="absolute bottom-full left-1/2 z-40 mb-2 flex -translate-x-1/2 flex-col gap-2">
            <ScreenPicker onClose={() => setScr(false)} />
          </div>
        )}
        {sb && <div className="absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2"><BoardPicker onClose={() => setSb(false)} /></div>}
      </div>
    </div>
  )
}

/** "X ruft an": join or let it ring out. */
export function CallRing({ className = '' }) {
  const r = useCall(s => s.ringing)
  const inCall = useCall(s => s.call)
  if (!r || inCall?.convId === r.convId) return null
  return (
    <div data-hit className={`flex w-80 items-center gap-3 rounded-2xl border border-white/[0.08] bg-ink-900/[0.97] px-3.5 py-3 shadow-lift backdrop-blur animate-pop ${className}`} style={{ pointerEvents: 'auto' }}>
      <span className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />
        {r.title ? <GroupAvatar title={r.title} id={r.convId} size={40} /> : <PersonAvatar id={r.from} name={r.name} size={40} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{r.title || r.name}</span>
        <span className="block truncate text-[12px] text-ink-400">{r.title ? `${r.name} ruft an` : 'ruft an'}</span>
      </span>
      <button title="Nicht rangehen" onClick={() => useCall.getState().decline()} className="grid h-9 w-9 place-items-center rounded-full bg-rose-500 text-white hover:bg-rose-400"><PhoneOff size={16} /></button>
      <button title="Rangehen" onClick={() => useCall.getState().join(r.convId)} className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500 text-white hover:bg-emerald-400"><Phone size={16} /></button>
    </div>
  )
}

/** Launcher: the call as a small panel in the corner (cameras on top when there are some). */
export function CallDock() {
  const call = useCall(s => s.call)
  const page = useCall(s => s.expanded) ? 'call' : ''
  const videos = useCall(s => s.videos)
  const screens = useCall(s => s.screens)
  const selfView = useCall(s => s.selfView)
  const members = useCall(s => s.members)
  const outgoing = useCall(s => !!s.outgoing)
  const muted = useCall(s => s.muted)
  const [mini, setMini] = useState(() => load('callDockMini', false))
  useTick(!!call && mini)
  const small = v => { setMini(v); save('callDockMini', v) }
  if (!call || page === 'call') return null
  if (mini) {
    const n = Object.keys(members).length
    return (
      <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-white/[0.08] bg-ink-900/[0.97] py-1.5 pl-3.5 pr-1.5 shadow-lift backdrop-blur animate-pop">
        <Phone size={14} className="shrink-0 text-emerald-400" />
        <button className="max-w-[150px] truncate text-left text-[12.5px] font-semibold hover:underline" title="Aufklappen" onClick={() => small(false)}>{call.title}</button>
        <span className="text-[11px] tabular-nums text-ink-400">{outgoing ? 'klingelt' : `${since(call.since)}${n ? ` · ${n + 1}` : ''}`}</span>
        <Btn small on={muted} title={muted ? 'Mikro an' : 'Mikro aus'} onClick={() => useCall.getState().toggleMute()}>{muted ? <MicOff size={15} className="text-rose-300" /> : <Mic size={15} />}</Btn>
        <Btn small title="Aufklappen" onClick={() => small(false)}><Maximize2 size={14} /></Btn>
        <Btn small danger title="Auflegen" onClick={() => useCall.getState().leave()}><PhoneOff size={15} /></Btn>
      </div>
    )
  }
  const shared = sharedScreens(screens, members)
  const remote = shared.length ? shared.map(x => [x.key, x.stream, x.label]) : Object.entries(videos).filter(([id]) => id !== 'me')
  const own = selfView ? videos.me : null
  return (
    <div className="fixed bottom-4 left-4 z-40 flex w-[300px] flex-col rounded-2xl border border-white/[0.08] bg-ink-900/[0.97] shadow-lift backdrop-blur animate-pop">
      {(remote.length > 0 || own) && (
        <div className="relative aspect-video w-full overflow-hidden rounded-t-2xl bg-black">
          {remote.length > 0
            ? <div className={`grid h-full w-full ${remote.length > 1 ? 'grid-cols-2' : ''}`}>{remote.slice(0, 4).map(([id, st, label]) => <VideoBox key={id} stream={st} contain={!!label} label={label || members[id]?.name} />)}</div>
            : <VideoBox stream={own} mirror label="Du" />}
          {remote.length > 0 && own && (
            <div className="absolute bottom-2 right-2 h-[54px] w-[96px] overflow-hidden rounded-lg ring-1 ring-white/20"><VideoBox stream={own} mirror /></div>
          )}
        </div>
      )}
      <div className="h-[300px]">
        <CallControls compact onMinimize={() => small(true)} onExpand={() => useCall.getState().expand(true)} />
      </div>
    </div>
  )
}

/** Screens others share (only those they still announce), newest person last. */
function sharedScreens(screens, members) {
  const out = []
  for (const [id, m] of Object.entries(members || {})) {
    for (const x of m.screens || []) {
      const stream = screens?.[id]?.[x.id]
      if (stream) out.push({ key: `${id}:${x.id}`, stream, label: `${m.name || 'Jemand'}: ${x.name}` })
    }
  }
  return out
}

function VideoBox({ stream, mirror, label, contain }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  return (
    <div className="relative h-full w-full overflow-hidden">
      <video ref={ref} autoPlay playsInline muted className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''}`} />
      {label && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10.5px]">{label}</span>}
    </div>
  )
}

function Tile({ stream, name, label, avatar, id, speaking, mirror, onHide }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  return (
    <div className={`group relative aspect-video overflow-hidden rounded-2xl bg-ink-850 ring-2 transition ${speaking ? 'ring-emerald-400' : 'ring-transparent'}`}>
      {onHide && (
        <button onClick={onHide} title="Eigenes Bild ausblenden (die anderen sehen dich weiter)"
          className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg bg-black/50 text-white opacity-0 transition hover:bg-black/70 group-hover:opacity-100">
          <EyeOff size={15} />
        </button>
      )}
      {stream
        ? <video ref={ref} autoPlay playsInline muted className={`h-full w-full object-cover ${mirror ? '-scale-x-100' : ''}`} />
        : <div className="grid h-full place-items-center"><PersonAvatar id={id} name={name} url={avatar} size={72} /></div>}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[12px] font-medium">{label || name}</span>
    </div>
  )
}

/** A shared screen, big. Double click: full screen. */
function ScreenTile({ stream, label, onStop }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  return (
    <div className="group relative min-h-0 overflow-hidden rounded-2xl bg-black ring-1 ring-white/[0.08]"
      onDoubleClick={e => { const el = e.currentTarget; document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.().catch(() => {}) }}>
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-contain" />
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-[12px] font-medium"><MonitorUp size={12} /> {label}</span>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        {onStop && <button onClick={onStop} title="Nicht mehr teilen" className="grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-rose-200 hover:bg-black/80"><X size={15} /></button>}
        <button onClick={e => { const el = e.currentTarget.closest('.group'); document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.().catch(() => {}) }} title="Vollbild" className="grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-white hover:bg-black/80"><Maximize2 size={15} /></button>
      </div>
    </div>
  )
}

/** Launcher: big view with everyone's camera (or picture), shared screens on top. */
export function CallPage() {
  const call = useCall(s => s.call)
  const members = useCall(s => s.members)
  const videos = useCall(s => s.videos)
  const screens = useCall(s => s.screens)
  const myScreens = useCall(s => s.myScreens) || []
  const speaking = useCall(s => s.speaking)
  const selfView = useCall(s => s.selfView)
  const me = useSocial(s => s.me)
  if (!call) {
    return (
      <div className="grid h-full place-items-center px-10 text-center text-sm text-ink-400">
        <div>Gerade kein Anruf. Starten geht oben im Chat mit dem Hörer.<br />
          <button className="btn-soft mt-4" onClick={() => useCall.getState().expand(false)}>Zurück zum Chat</button>
        </div>
      </div>
    )
  }
  const ids = Object.keys(members)
  const camera = useCall.getState().camera
  const showOwn = !camera || selfView
  const tiles = ids.length + (showOwn ? 1 : 0)
  const shared = [
    ...myScreens.map(x => ({ key: 'me:' + x.id, stream: screens.me?.[x.id], label: `Du: ${x.name}`, stop: () => useCall.getState().stopScreen(x.id) })),
    ...sharedScreens(screens, members),
  ].filter(x => x.stream)
  const cols = shared.length
    ? (tiles <= 4 ? 'grid-cols-4' : 'grid-cols-6')
    : tiles <= 1 ? 'grid-cols-1' : tiles <= 4 ? 'grid-cols-2' : 'grid-cols-3'
  return (
    <div className="flex h-full flex-col gap-4 p-3 animate-fade-in md:flex-row md:gap-5 md:px-8 md:py-6">
      {/* controls on the left: the chat can float over the right side */}
      <div className="card h-[45%] w-full shrink-0 md:h-full md:w-[320px]">
        <CallControls onMinimize={() => useCall.getState().expand(false)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
      {shared.length > 0 && (
        <div className={`grid min-h-0 flex-1 gap-3 ${shared.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {shared.map(x => <ScreenTile key={x.key} stream={x.stream} label={x.label} onStop={x.stop} />)}
        </div>
      )}
      <div className={`relative grid min-w-0 gap-4 ${shared.length ? 'shrink-0' : 'flex-1 content-center'} ${cols}`}>
        {!showOwn && (
          <button onClick={() => useCall.getState().toggleSelfView()} className="absolute right-0 top-0 z-10 flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-ink-300 hover:text-white">
            <Eye size={14} /> Eigenes Bild zeigen
          </button>
        )}
        {showOwn && <Tile id={me?.id} name={me?.player_name || 'Du'} label={`${me?.player_name || 'Du'} (du)`} avatar={me?.avatar_url} stream={videos.me} speaking={!!speaking.me} mirror onHide={camera ? () => useCall.getState().toggleSelfView() : null} />}
        {ids.map(id => <Tile key={id} id={id} name={members[id].name || 'Jemand'} avatar={members[id].avatar} stream={videos[id]} speaking={!!speaking[id]} />)}
      </div>
      </div>
    </div>
  )
}

/** Header button in a chat: start the call, join a running one, or show that you're in it. */
export function CallButtons({ convId }) {
  const inCall = useCall(s => s.call?.convId === convId)
  const running = useCall(s => (s.active[convId] || []).length > 0)
  const c = useCall.getState()
  const btn = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-white/[0.07] hover:text-white'
  if (inCall) return <button className={`${btn} text-emerald-300`} title="Im Anruf (groß ansehen)" onClick={() => useCall.getState().expand(true)}><Phone size={16} /></button>
  if (running) {
    return <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 text-[12px] font-semibold text-white hover:bg-emerald-400" onClick={() => c.join(convId)}><Phone size={14} /> Beitreten</button>
  }
  return (
    <>
      <button className={btn} title="Anrufen" onClick={() => c.join(convId)}><Phone size={16} /></button>
      <button className={btn} title="Videoanruf" onClick={() => c.join(convId, { video: true })}><Video size={16} /></button>
    </>
  )
}
