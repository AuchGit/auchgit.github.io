// Going live (store/useLive): start it, see who's live, watch / listen, the viewer chat.
// The same parts in the launcher window (LiveDock), the overlay (window "live") and on
// the website.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, ExternalLink, Eye, Gauge, Plus, Scissors, SlidersHorizontal, Headphones, Loader2, Mic, MicOff, Monitor, Radio, RefreshCw, Send, VideoOff, Volume2, VolumeX, X } from 'lucide-react'
import { BUFFER_MAX, QUALITIES, programOk, useLive } from './useLive'
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
  // program sound: everything but the launcher, or the ticked programs (remembered by name)
  const [all, setAll] = useState(programOk && last.all !== false && !last.names?.length)
  const [picked, setPicked] = useState(() => new Set(last.names || []))
  const [mic, setMic] = useState(!!last.mic)
  const [quality, setQuality] = useState(QUALITIES[last.quality] ? String(last.quality) : '1080')
  // the desktop app takes a screen straight from the graphics chip ('' = main screen,
  // 'pick' = the system's picker for a single window)
  const [screen, setScreen] = useState(typeof last.screen === 'string' && !last.screen.startsWith('window:') ? last.screen : '')
  const [screens, setScreens] = useState(null)
  // single windows (only the game, whatever lies on top of it); the last program comes back by its exe
  const [wins, setWins] = useState([])
  const loadWins = () => {
    const f = useLive.getState().windows
    if (!f) return
    f().then(l => {
      const list = Array.isArray(l) ? l : []
      setWins(list)
      if (last.windowExe) { const again = list.find(w => w.exe === last.windowExe && !w.minimized); if (again) setScreen(s => (s === '' || s.startsWith('window:') ? again.id : s)) }
    }).catch(() => {})
  }
  useEffect(() => { const f = useLive.getState().screens; if (f) f().then(l => setScreens(Array.isArray(l) ? l : [])).catch(() => setScreens([])); loadWins() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pickedWin = wins.find(w => w.id === screen)
  const [title, setTitle] = useState('')
  const [announce, setAnnounce] = useState(last.announce !== false)
  const [sources, setSources] = useState([])
  const starting = useLive(s => s.starting)
  const error = useLive(s => s.error)
  const mirror = useLive(s => s.mirror)
  const scan = () => { if (programOk) calls.sources().then(setSources).catch(() => {}) }
  useEffect(scan, [])
  const keyOf = src => (src.exe || src.name || '').toLowerCase()
  const chosen = all ? [{ pid: 0, name: 'Alles außer dem Launcher' }] : sources.filter(x => picked.has(keyOf(x))).map(x => ({ pid: x.pid, name: x.name }))
  const flip = src => {
    setAll(false)
    const next = new Set(picked)
    if (next.has(keyOf(src))) next.delete(keyOf(src)); else next.add(keyOf(src))
    setPicked(next)
  }
  const ok = !!(video || chosen.length || mic)
  async function go() {
    save('liveLast', { video, all, names: all ? [] : [...picked], mic, announce, quality, screen, windowExe: pickedWin?.exe || null })
    await useLive.getState().start({ video, programs: chosen, mic, title, announce, convId, quality, screen })
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
        {video === 'screen' && screens && (
          <div className="mt-1.5 flex gap-1">
            <select value={screens.some(x => x.name === screen) || screen === 'pick' || pickedWin ? screen : ''} onChange={e => setScreen(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-900 px-2 text-[12px] text-white outline-none focus:border-brand-400">
              <optgroup label="Ganzer Bildschirm">
                {screens.map(x => <option key={x.name} value={x.primary ? '' : x.name}>{x.label}</option>)}
              </optgroup>
              {wins.length > 0 && (
                <optgroup label="Nur ein Fenster (was darüber liegt, sieht keiner)">
                  {wins.map(w => <option key={w.id} value={w.id}>{w.title}{w.minimized ? ' (minimiert)' : ''}</option>)}
                </optgroup>
              )}
              <option value="pick">Über Windows auswählen (alte Aufnahme, ruckelt mehr)</option>
            </select>
            <button type="button" onClick={loadWins} title="Fensterliste neu laden" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-ink-400 hover:text-white"><RefreshCw size={13} /></button>
          </div>
        )}
        {video === 'screen' && pickedWin?.minimized && (
          <p className="mt-1 text-[11px] leading-snug text-amber-200/80">Das Fenster ist minimiert: solange gibt es kein Bild.</p>
        )}
        {video === 'screen' && (
          <QualityPick value={quality} onChange={setQuality} />
        )}
      </div>
      <div>
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-500">Ton</div>
        {programOk ? (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
            <Tick on={all} onClick={() => { setAll(!all); if (!all) setPicked(new Set()) }} label="Alles außer dem Launcher" />
            <div className="my-1 flex items-center gap-2 px-1.5 text-[10.5px] text-ink-500">
              <span className="h-px flex-1 bg-white/[0.06]" /> oder nur diese <span className="h-px flex-1 bg-white/[0.06]" />
              <button type="button" onClick={scan} title="Liste neu laden" className="grid h-5 w-5 place-items-center rounded text-ink-500 hover:text-white"><RefreshCw size={11} /></button>
            </div>
            <div className="max-h-32 overflow-y-auto">
              {sources.map(x => <Tick key={x.pid} on={!all && picked.has(keyOf(x))} onClick={() => flip(x)} label={x.name} hint={x.active ? 'spielt gerade' : null} />)}
              {!sources.length && <p className="px-2 py-1 text-[11px] text-ink-500">Gerade spielt kein Programm Sound ab.</p>}
            </div>
          </div>
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

function Tick({ on, onClick, label, hint }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-white/[0.05]">
      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-rose-400 bg-rose-500 text-white' : 'border-white/25'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
      <span className={`min-w-0 flex-1 truncate ${on ? 'text-white' : 'text-ink-200'}`}>{label}</span>
      {hint && <span className="shrink-0 text-[10.5px] text-emerald-300/80">{hint}</span>}
    </button>
  )
}

// ------------------------------------------------------------------ chat
export function LiveChat({ host = false }) {
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

// ------------------------------------------------------------------ clip that
const clipLen = () => ({ 30: '30 Sekunden', 120: '2 Minuten' }[load('settings', {}).liveClipSeconds] || 'Minute')
const mbOf = n => (n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })

/** "Clip": the last minute as a video. watch: of the live you watch, else of yours. */
function ClipButton({ watch = false }) {
  const busy = useLive(s => (watch ? s.wclipping : s.clipping))
  const key = useLive(s => (watch ? '' : s.clipKeyLabel))
  const len = clipLen()
  return (
    <button onClick={() => (watch ? useLive.getState().clipWatch() : useLive.getState().clip())} disabled={busy}
      title={`Clip: die letzte${len === 'Minute' ? '' : 'n'} ${len} als Video speichern${key ? ` (${key})` : ''}`} className={btn}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} />}
    </button>
  )
}

/** After a clip: saved (watch it, show it in the folder) or what went wrong. Goes away after 30 s. */
function ClipNote({ watch = false }) {
  const note = useLive(s => (watch ? s.wclipNote : s.clipNote))
  const open = useLive(s => s.openClip)
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!note) return undefined
    const t = setTimeout(() => redraw(n => n + 1), Math.max(0, 30000 - (Date.now() - note.at)))
    return () => clearTimeout(t)
  }, [note])
  if (!note || Date.now() - note.at > 30000) return null
  if (note.error) return <p className="mx-3 mb-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-[11.5px] text-rose-200">{note.error}</p>
  const link = 'shrink-0 rounded-md px-1.5 py-0.5 font-medium hover:bg-white/10'
  return (
    <div className="mx-3 mb-1.5 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11.5px] text-emerald-100">
      <Scissors size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={note.name}>{note.path ? 'Clip gespeichert' : 'Clip geladen'} · {mbOf(note.size)} MB</span>
      {note.path && open && (<>
        <button onClick={() => open(note.path)} className={link}>Ansehen</button>
        <button onClick={() => open(note.path, true)} className={link}>Ordner</button>
      </>)}
    </div>
  )
}

// ------------------------------------------------------------------ how the picture travels
const mbit = k => (k == null ? '?' : (k / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }))
const secs = v => v.toLocaleString('de-DE', { maximumFractionDigits: 1 })

/** Host: how the picture goes out (the weakest viewer), and what holds it back. */
function OutStats() {
  const stats = useLive(s => s.hstats)
  const list = Object.values(stats || {})
  if (!list.length) return null
  const x = list.reduce((a, b) => (b.fps < a.fps ? b : a))
  const chip = x.hw === true ? 'Grafikchip' : x.hw === false ? 'Prozessor' : null
  const tips = []
  if (x.src != null && x.src < 22) tips.push(`Die Aufnahme liefert nur ${x.src} Bilder pro Sekunde. Oft hilft: das Spielfenster statt des ganzen Bildschirms teilen, oder das Spiel im Fenster-Vollbild statt exklusivem Vollbild.`)
  const settled = x.age > 15000
  if (settled && x.why === 'cpu') tips.push('Der PC kommt mit dem Umwandeln nicht hinterher. „Flüssig (720p)“ nehmen oder weniger Zuschauer.')
  if (settled && x.why === 'bandwidth') tips.push('Deine Leitung ist zu knapp, das Bild wird kleiner oder ruckelt. „Flüssig (720p)“ hilft.')
  if ((x.rx?.recent ?? x.rx?.freezes) > 1) tips.push(`Bei ${x.name} hängt das Bild ab und zu${x.rx.loss > 1 ? ` (${secs(x.rx.loss)} % gehen unterwegs verloren)` : ''}. Hilft oft: dort beim Tacho die Verzögerung höher stellen.`)
  return (
    <div className="px-3 pb-1 text-[11px] leading-snug text-ink-500">
      <div className="tabular-nums" title={`${x.enc || ''}${x.rtt != null ? ` · ${x.rtt} ms hin und zurück` : ''}`}>
        Bild raus{list.length > 1 ? ` (schwächster von ${list.length})` : ''}: {x.fps} fps · {x.w}×{x.h} · {mbit(x.kbps)} Mbit/s{x.codec ? ` · ${x.codec}` : ''}{chip ? ` über ${chip}` : ''}
      </div>
      {tips.map(t => <div key={t} className="mt-0.5 text-amber-200/80">{t}</div>)}
    </div>
  )
}

/** Viewer: your delay (until it stops hanging) and how the picture comes in. */
function InStats({ video }) {
  const x = useLive(s => s.wstats)
  const buffer = useLive(s => s.buffer)
  const bad = x && x.recent > 0
  return (
    <div className="mx-3 mb-2 rounded-xl bg-white/[0.03] px-2.5 py-2 text-[11px] leading-snug text-ink-400">
      <label className="flex items-center gap-2 text-[11.5px] text-ink-300">
        <span className="shrink-0">Verzögerung</span>
        <input type="range" min={0} max={BUFFER_MAX} step={100} value={buffer} onChange={e => useLive.getState().setBuffer(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 accent-rose-500" aria-label="Verzögerung" />
        <span className="w-10 shrink-0 text-right tabular-nums">{secs(buffer / 1000)} s</span>
      </label>
      {video && x && (
        <div className={`mt-1 tabular-nums ${bad ? 'text-amber-200/90' : 'text-emerald-300/80'}`}>
          {bad ? `${x.recent} Hänger in den letzten 30 s: Verzögerung höher stellen.` : 'Keine Hänger in den letzten 30 s.'}
        </div>
      )}
      <p className="mt-1 text-ink-500">Ruckelt es bei dir? Höher stellen, bis es flüssig läuft. Bild und Ton kommen dann etwas später, laufen aber rund. Wird für {useLive.getState().watching?.name || 'diesen Stream'} gemerkt.</p>
      {video && x && (
        <div className="mt-1.5 tabular-nums text-ink-500" title={x.dec || ''}>
          {x.fps} fps · {x.w}×{x.h} · {mbit(x.kbps)} Mbit/s · Hänger gesamt: {x.freezes}{x.freezes ? ` (${secs(x.frozen)} s)` : ''}
          {x.loss != null ? ` · Verlust ${secs(x.loss)} %` : ''}{x.delay != null ? ` · Puffer gerade ${x.delay} ms` : ''}{x.rtt != null ? ` · Ping ${x.rtt} ms` : ''}
        </div>
      )}
    </div>
  )
}

/** Flüssig / Scharf / Beste (size and bits per viewer). */
function QualityPick({ value, onChange }) {
  return (
    <div className="mt-1.5 flex gap-1.5">
      {Object.entries(QUALITIES).map(([q, x]) => (
        <button type="button" key={q} onClick={() => onChange(q)} title={x.hint}
          className={`h-7 flex-1 rounded-md border text-[11.5px] transition ${String(value) === q ? 'border-white/25 bg-white/[0.08] text-white' : 'border-white/[0.06] text-ink-400 hover:text-white'}`}>{x.label}</button>
      ))}
    </div>
  )
}

/** The programs whose sound goes out: remove one, add one (while live). */
function LivePrograms({ live }) {
  const [adding, setAdding] = useState(false)
  const [sources, setSources] = useState([])
  const list = live.programs || []
  const everything = list.some(p => p.pid === 0)
  const open = () => { setAdding(a => !a); calls.sources().then(setSources).catch(() => {}) }
  const here = new Set(list.map(p => p.pid))
  const chip = 'flex h-6 items-center gap-1 rounded-md bg-white/[0.06] pl-2 pr-1 text-[11.5px] text-ink-200'
  return (
    <div className="px-3 pt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {list.map(p => (
          <span key={p.pid} className={chip} title={p.name}>
            <span className="max-w-[120px] truncate">{p.name}</span>
            <button onClick={() => useLive.getState().removeProgram(p.pid)} title="Den Sound rausnehmen" className="grid h-4 w-4 place-items-center rounded text-ink-400 hover:bg-white/10 hover:text-white"><X size={11} /></button>
          </span>
        ))}
        {!everything && programOk && (
          <button onClick={open} title="Den Sound eines Programms dazunehmen" className={`flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] ${adding ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.06] hover:text-white'}`}>
            <Plus size={12} /> Programm
          </button>
        )}
      </div>
      {adding && !everything && (
        <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
          {!list.length && <Tick on={false} onClick={() => { useLive.getState().addProgram({ pid: 0, name: 'Alles außer dem Launcher' }); setAdding(false) }} label="Alles außer dem Launcher" />}
          {sources.filter(x => !here.has(x.pid)).map(x => (
            <Tick key={x.pid} on={false} onClick={() => { useLive.getState().addProgram({ pid: x.pid, name: x.name }); setAdding(false) }} label={x.name} hint={x.active ? 'spielt gerade' : null} />
          ))}
          {!sources.filter(x => !here.has(x.pid)).length && <p className="px-2 py-1 text-[11px] text-ink-500">Gerade spielt kein weiteres Programm Sound ab.</p>}
        </div>
      )}
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
  const [peek, setPeek] = useState(false)
  const chatOut = useLive(s => s.chatOut)
  const canOut = useLive(s => !!s.canDetachChat)
  if (!live) return null
  const list = Object.values(viewers)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <LivePill />
        <span className="text-[12px] tabular-nums text-ink-300">{clock(live.since)}</span>
        <span className="flex items-center gap-1 text-[12px] text-ink-400" title={list.map(v => v.name).join(', ') || 'Noch niemand'}><Eye size={13} /> {list.length}</span>
        <div className="flex-1" />
        {canOut && !chatOut && (
          <button onClick={() => useLive.getState().setChatOut(true)} title="Chat als eigenes Fenster (im Overlay, über dem Spiel)" className={btn}><ExternalLink size={14} /></button>
        )}
        {live.clips && <ClipButton />}
        <button onClick={() => useLive.getState().toggleMic()} title={live.mic ? 'Mikro aus' : 'Mikro an'} className={`${btn} ${live.mic ? '' : 'text-rose-300'}`}>{live.mic ? <Mic size={15} /> : <MicOff size={15} />}</button>
        <button onClick={() => { if (sure) useLive.getState().stop(); else { setSure(true); setTimeout(() => setSure(false), 3000) } }}
          className={`h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold ${sure ? 'bg-rose-500 text-white' : 'bg-white/[0.07] text-rose-200 hover:bg-rose-500/20'}`}>{sure ? 'Wirklich?' : 'Beenden'}</button>
      </div>
      <ClipNote />
      {preview && !mirror && (live.video === 'cam' || peek)
        ? <Video stream={preview} className="aspect-video w-full shrink-0 bg-black object-contain" />
        : live.video === 'screen' && !mirror && <button onClick={() => setPeek(true)} className="mx-3 flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white/[0.04] text-[11.5px] text-ink-400 hover:text-white"><Monitor size={13} /> Dein Bildschirm geht raus. Vorschau zeigen</button>}
      {peek && live.video === 'screen' && !mirror && <button onClick={() => setPeek(false)} className="mx-3 mt-1 text-left text-[11px] text-ink-500 hover:text-white">Vorschau aus (spart Leistung)</button>}
      {live.title && <div className="truncate px-3 pt-1.5 text-[12.5px] font-medium">{live.title}</div>}
      <div className="px-3 pt-1 text-[11.5px] text-ink-400">
        {what(live)}{live.program ? ` · ${live.program}` : ''}{live.mic ? ' · Mikro' : ''}
      </div>
      {live.video === 'screen' && <div className="px-3"><QualityPick value={live.quality || '720'} onChange={q => useLive.getState().setQuality(q)} /></div>}
      {(programOk || (live.programs || []).length > 0) && <LivePrograms live={live} />}
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
      {live.video && <OutStats />}
      {error && <p className="mx-3 rounded-lg bg-rose-500/10 px-2 py-1 text-[11.5px] text-rose-200">{error}</p>}
      {chatOut ? (
        <div className="mx-3 mb-2 mt-auto flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[11.5px] text-ink-400">
          <ExternalLink size={13} className="shrink-0" /> <span className="min-w-0 flex-1">Der Chat ist in einem eigenen Fenster.</span>
          <button onClick={() => useLive.getState().setChatOut(false)} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-ink-200 hover:bg-white/10">Zurückholen</button>
        </div>
      ) : <LiveChat host />}
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
  const lines = useLive(s => s.lines)
  const levels = useLive(s => s.levels)
  const [mix, setMix] = useState(false)
  const [info, setInfo] = useState(false)
  if (!w) return null
  // the mic line is always there, but only worth a slider while it's on
  const shownLines = lines.filter(l => l.kind !== 'mic' || hostLive?.mic)
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
        {showVideo && w.clips && <ClipButton watch />}
        {shownLines.length > 1 && (
          <button onClick={() => setMix(m => !m)} title="Lautstärke pro Programm und Mikro" className={`${btn} ${mix ? 'bg-white/[0.08] text-white' : ''}`}>
            <SlidersHorizontal size={15} />
          </button>
        )}
        {!connecting && (
          <button onClick={() => setInfo(v => !v)} title="Verzögerung einstellen (gegen Ruckeln) und wie das Bild ankommt" className={`${btn} ${info ? 'bg-white/[0.08] text-white' : ''}`}>
            <Gauge size={15} />
          </button>
        )}
        {hostLive?.video && (
          <button onClick={() => useLive.getState().setWant(w.want === 'both' ? 'audio' : 'both')} title={w.want === 'both' ? 'Nur Ton (spart Daten)' : 'Mit Bild'}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[11.5px] text-ink-200 hover:bg-white/[0.1]">
            {w.want === 'both' ? <><Headphones size={13} /> Nur Ton</> : <><Eye size={13} /> Mit Bild</>}
          </button>
        )}
      </div>
      <ClipNote watch />
      {info && !connecting && <InStats video={showVideo} />}
      {mix && shownLines.length > 1 && (
        <div className="mx-3 mb-2 space-y-1.5 rounded-xl bg-white/[0.03] px-2.5 py-2">
          <datalist id="live-level-marks"><option value="100" /></datalist>
          {shownLines.map(l => {
            const v = levels[`${l.kind}:${l.name}`] ?? 100
            return (
              <label key={l.id} className="flex items-center gap-2 text-[11.5px] text-ink-300">
                <span className="w-24 shrink-0 truncate" title={l.name}>{l.kind === 'mic' ? <Mic size={11} className="mr-1 inline" /> : null}{l.name}</span>
                <input type="range" min={0} max={200} step={5} list="live-level-marks" value={v} onChange={e => useLive.getState().setLevel(l, Number(e.target.value))}
                  onDoubleClick={() => useLive.getState().setLevel(l, 100)} title="Doppelklick: 100 %"
                  className={`h-1 min-w-0 flex-1 ${v > 100 ? 'accent-amber-400' : 'accent-rose-500'}`} aria-label={`Lautstärke ${l.name}`} />
                <span className={`w-9 shrink-0 text-right tabular-nums ${v > 100 ? 'text-amber-300' : ''}`}
                  title={v > 100 ? 'Über 100 %: ein Begrenzer fängt die Spitzen ab, damit nichts übersteuert' : undefined}>{v}%</span>
              </label>
            )
          })}
          <p className="text-[10.5px] leading-snug text-ink-500">Bis 200 %. Über 100 % fängt ein Begrenzer die Spitzen ab, damit nichts kratzt.</p>
        </div>
      )}
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
