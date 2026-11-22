// Chat extras: emoji picker, previews for image / GIF / YouTube links, game invites.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gamepad2, ImagePlus, Loader2, Pencil, Play, Plus, Smile, Volume2, VolumeX } from 'lucide-react'
import { gameState, useLauncher } from './shim'
import { useSocial } from './useSocial'
import { api } from './shim'
import { EMOTES, emote } from './emotes'
import { EMOTE_MAX, codeFromFile, customEmotes, openEmote, prepareEmote, useEmotes } from './useEmotes'
import EmoteCrop, { CropPreview, squareOf } from './EmoteCrop'

// ------------------------------------------------------------------ emojis
const SETS = [
  ['Smileys', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👻 👽 🤖'],
  ['Gesten', '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 💪 👏 🙌 👐 🤲 ✍️ 🫡 🫶 👀 🧠 🫠 🤷 🤦 🙋 🙅 🙆 💁 🙇'],
  ['Herzen', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊'],
  ['Zocken', '🎮 🕹️ 👾 🎲 ♟️ 🃏 🏆 🥇 🥈 🥉 🎯 ⚔️ 🗡️ 🛡️ 🏹 🪄 💣 🧨 💎 👑 🗺️ 🧭 ⏳ 🔔 🎧 🎵 🎶 📢 💬 💭 🗯️ 🚀 🛸 🐉 🧙 🧟 🥷'],
  ['Sonst', '🍕 🍔 🍟 🌭 🍿 🧃 🥤 ☕ 🍺 🍻 🥂 🍩 🍪 🎂 🍰 🍫 🍉 🍓 🐶 🐱 🐸 🦊 🐻 🐼 🐧 🦆 🦄 🐍 🐢 🐙 🌈 ☀️ 🌙 ❄️ 🌊 🌵 🌹 💤 ✅ ❌ ❓ ❗ ⚠️ 🆗 🆒 🆕'],
].map(([name, list]) => [name, list.split(' ')])

const RECENT = 'auch.emoji.recent'
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT)) || [] } catch { return [] } }

/**
 * Smiley button: emojis by topic, emotes (yours, your friends', the Twitch ones),
 * and the last ones used. Your own emotes are made and changed right here.
 * `onPick(text, word)`: word = true for an emote code (needs spaces around it).
 */
export function EmojiButton({ onPick }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(() => (loadRecent().length ? -1 : 0))
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState(null) // { img, code } (new) or { edit } (yours)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const box = useRef(null)
  const fileRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = e => { if (!box.current?.contains(e.target)) { setOpen(false); setForm(null); setEditing(false) } }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  useEmotes(s => s.list) // new / renamed ones show right away
  const missing = useEmotes(s => s.missing)
  useEffect(() => { if (open) useEmotes.getState().load() }, [open])
  const { groups, byCode } = customEmotes()
  const find = e => emote(e, byCode)
  // emote codes of people you're no longer friends with drop out
  const recent = loadRecent().filter(e => find(e) || !/^[\w:]+$/.test(e))
  const EMOTE_TAB = SETS.length
  const q = filter.trim().toLowerCase()
  const match = e => !q || e.code.toLowerCase().includes(q)
  const sections = tab !== EMOTE_TAB ? [] : [
    ...groups.map(g => ({ key: g.owner, name: g.name, mine: g.mine, items: g.items.filter(match) })).filter(g => g.items.length || (g.mine && !q && !missing)),
    { key: 'twitch', name: 'Twitch', items: EMOTES.filter(match) },
  ]
  const list = tab === -1 ? recent : tab === EMOTE_TAB ? [] : SETS[tab][1]
  function pick(e) {
    try { localStorage.setItem(RECENT, JSON.stringify([e, ...recent.filter(x => x !== e)].slice(0, 24))) } catch { /* ignore */ }
    onPick(e, !!find(e))
  }
  async function chosen(f) {
    window.__auchPicking = false
    if (!f) return
    setErr(null); setBusy(true)
    try { const src = await openEmote(f); setForm({ src, code: codeFromFile(f.name) }) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const mineCount = groups.find(g => g.mine)?.items.length || 0
  const tile = (e, onClick, extra = null) => (
    <button key={e.code} type="button" onClick={onClick} title={e.code}
      className="relative grid h-11 place-items-center rounded-lg leading-none hover:bg-white/[0.08]">
      <img src={e.url} alt={e.code} loading="lazy" className="max-h-8 max-w-[40px]" />
      {extra}
    </button>
  )
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} title="Emojis und Emotes"
        className={`grid h-8 w-8 place-items-center rounded-lg transition ${open ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.07] hover:text-white'}`}>
        <Smile size={17} />
      </button>
      {open && (
        <div className="card absolute bottom-full right-0 z-40 mb-2 w-[300px] max-w-[calc(100vw-24px)] bg-ink-800/95 p-2 shadow-lift">
          <div className="mb-1.5 flex gap-1 overflow-x-auto">
            {recent.length > 0 && <TabBtn on={tab === -1} onClick={() => setTab(-1)}>Zuletzt</TabBtn>}
            <TabBtn on={tab === EMOTE_TAB} onClick={() => setTab(EMOTE_TAB)}>Emotes</TabBtn>
            {SETS.map(([name], i) => <TabBtn key={name} on={tab === i} onClick={() => setTab(i)}>{name}</TabBtn>)}
          </div>
          {tab === EMOTE_TAB && form ? (
            <EmoteForm {...form} onDone={() => setForm(null)} />
          ) : tab === EMOTE_TAB ? (<>
            <input autoFocus value={filter} onChange={e => setFilter(e.target.value)} placeholder="Emote suchen (KEKW, Pog …)"
              className="mb-1.5 h-8 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[12.5px] text-white outline-none focus-visible:outline-none placeholder:text-ink-500 focus:border-brand-400" />
            {err && <p className="mb-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-[11.5px] text-rose-200">{err}</p>}
            <div className="overflow-y-auto" style={{ maxHeight: Math.max(130, Math.min(260, 420 - 96)) }}>
              {sections.map(sec => (
                <section key={sec.key} className="mb-1.5">
                  <div className="flex h-6 items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                    <span className="min-w-0 flex-1 truncate">{sec.name}</span>
                    {sec.mine && <span className="tabular-nums normal-case tracking-normal">{mineCount}/{EMOTE_MAX}</span>}
                    {sec.mine && mineCount > 0 && (
                      <button type="button" onClick={() => setEditing(v => !v)} className={`normal-case tracking-normal ${editing ? 'text-brand-300' : 'hover:text-white'}`}>{editing ? 'Fertig' : 'Bearbeiten'}</button>
                    )}
                  </div>
                  <div className="grid grid-cols-6 gap-0.5">
                    {sec.items.map(e => (sec.mine && editing
                      ? tile(e, () => setForm({ edit: e }), <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded bg-ink-950/80 text-white"><Pencil size={9} /></span>)
                      : tile(e, () => pick(e.code))))}
                    {sec.mine && !q && mineCount < EMOTE_MAX && (
                      <button type="button" disabled={busy} title="Eigenes Emote hochladen (PNG, JPG, WebP oder GIF)"
                        onClick={() => { setErr(null); window.__auchPicking = true; fileRef.current?.click() }}
                        className="grid h-11 place-items-center rounded-lg border border-dashed border-white/15 text-ink-400 hover:border-brand-400 hover:text-white">
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
                      </button>
                    )}
                  </div>
                  {sec.mine && !mineCount && !q && <p className="px-1 pt-1 text-[11px] leading-snug text-ink-500">Lad eigene hoch. Du und deine Freunde könnt sie dann benutzen.</p>}
                </section>
              ))}
              {missing && !q && <p className="px-1 pb-1 text-[11px] text-ink-500">Eigene Emotes gehen, sobald die Datenbank so weit ist.</p>}
              {q && sections.every(sec => !sec.items.length) && <p className="p-2 text-[12px] text-ink-400">Kein Emote mit dem Namen.</p>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; chosen(f) }} />
          </>) : (
            <div className="grid grid-cols-8 gap-0.5 overflow-y-auto" style={{ maxHeight: Math.max(110, Math.min(224, 420 - 96)) }}>
              {list.map(e => {
                const em = find(e)
                return (
                  <button key={e} type="button" onClick={() => pick(e)} title={em ? e : undefined}
                    className={`grid place-items-center rounded-lg leading-none hover:bg-white/[0.08] ${em ? 'h-11' : 'h-9 text-[20px]'}`}>
                    {em ? <img src={em.url} alt={e} loading="lazy" className="max-h-8 max-w-[34px]" /> : e}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A new emote: cut out the part you want and name it; or rename / delete one of yours.
 * `src` from openEmote, `onDone(code | null | undefined)`.
 */
export function EmoteForm({ src, edit, code: first = '', onDone }) {
  const [code, setCode] = useState(edit ? edit.code : first)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sure, setSure] = useState(false)
  const [crop, setCrop] = useState(() => (src ? src.box : null))
  const [square, setSquare] = useState(false)
  const canCrop = !!src && (!src.animated || src.recode)
  const done = v => { if (src?.url) URL.revokeObjectURL(src.url); onDone(v) }
  async function save() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (edit) { if (code !== edit.code) await useEmotes.getState().rename(edit.id, code) } else {
        const img = await prepareEmote(src, canCrop ? crop : null)
        try { await useEmotes.getState().add(img, code) } finally { URL.revokeObjectURL(img.url) }
      }
      done(code)
    } catch (e) { setError(e.message); setBusy(false) }
  }
  async function del() {
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 3000); return }
    setBusy(true); setError(null)
    try { await useEmotes.getState().remove(edit.id); onDone(null) } catch (e) { setError(e.message); setBusy(false) }
  }
  const chip = on => `h-6 rounded-md px-2 text-[11px] font-medium transition ${on ? 'bg-white/[0.12] text-white' : 'text-ink-400 hover:bg-white/[0.07] hover:text-white'}`
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5">
      {canCrop && (
        <div className="mb-2.5">
          <EmoteCrop src={src} value={crop} onChange={setCrop} square={square} />
          <div className="mt-1.5 flex items-center gap-1">
            <button type="button" onClick={() => { const on = !square; setSquare(on); if (on) setCrop(c => squareOf(c, src)) }} className={chip(square)} title="Rahmen bleibt quadratisch">Quadratisch</button>
            <button type="button" onClick={() => { setSquare(false); setCrop({ x: 0, y: 0, w: src.w, h: src.h }) }} className={chip(false)} title="Das ganze Bild">Alles</button>
            {!src.animated && (src.box.w !== src.w || src.box.h !== src.h) && (
              <button type="button" onClick={() => { setSquare(false); setCrop(src.box) }} className={chip(false)} title="Nur was nicht durchsichtig ist">Rand weg</button>
            )}
            <span className="ml-auto text-[10.5px] tabular-nums text-ink-500">{crop.w}×{crop.h}</span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-white/[0.05]">
          {edit ? <img src={edit.url} alt="" className="max-h-12 max-w-[52px]" />
            : canCrop ? <CropPreview src={src} crop={crop} />
            : <img src={src.url} alt="" className="max-h-12 max-w-[52px]" />}
        </span>
        <label className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">Name</span>
          <input autoFocus value={code} placeholder="z. B. hypeKatze"
            onChange={e => setCode(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 24))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
            className="mt-0.5 h-8 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[13px] text-white outline-none focus-visible:outline-none placeholder:text-ink-500 focus:border-brand-400" />
        </label>
      </div>
      {error ? <p className="mt-2 text-[11.5px] leading-snug text-rose-200">{error}</p>
        : !edit && <p className="mt-2 text-[11px] leading-snug text-ink-500">{src.animated ? (src.recode ? 'Bewegt sich. Zugeschnitten wird es neu als GIF gespeichert. ' : 'Bewegt sich. Zuschneiden geht bei bewegten Bildern hier nicht. ') : ''}Am besten ein Name, den man nicht aus Versehen schreibt. Groß und klein zählt.</p>}
      <div className="mt-2 flex items-center gap-1.5">
        {edit && (
          <button type="button" onClick={del} disabled={busy}
            className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold ${sure ? 'bg-rose-500 text-white' : 'text-rose-300 hover:bg-rose-500/10'}`}>{sure ? 'Wirklich löschen?' : 'Löschen'}</button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => done(undefined)} className="btn-ghost inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold">Abbrechen</button>
        <button type="button" onClick={save} disabled={busy || code.length < 2} className="btn-brand inline-flex h-7 min-w-[78px] items-center justify-center rounded-lg px-3 text-[12px] font-semibold disabled:opacity-50">
          {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : 'Speichern'}
        </button>
      </div>
    </div>
  )
}

/**
 * Emote completion for the word left of the cursor (2+ letters, case-insensitive).
 * Tab completes it like on Twitch; the suggestion bar only shows for ":kek",
 * so normal words don't keep popping it up.
 */
export function emoteSuggestions(text, caret) {
  const m = text.slice(0, caret).match(/(?:^|\s)(:?)([^\s:]{2,})$/)
  if (!m) return { word: '', list: [], show: false }
  const w = m[2].toLowerCase()
  const list = [...customEmotes().flat, ...EMOTES].filter(e => e.code.toLowerCase().startsWith(w) && (m[1] || e.code !== m[2])).slice(0, 7)
  return { word: m[1] + m[2], list, show: !!m[1] && list.length > 0 }
}

export function EmoteSuggest({ list, active, onPick }) {
  if (!list.length) return null
  return (
    <div className="card absolute bottom-full left-3 right-3 z-30 mb-1 flex items-center gap-1 overflow-x-auto bg-ink-800/95 p-1 shadow-lift">
      {list.map((e, i) => (
        <button key={e.code} type="button" onMouseDown={ev => ev.preventDefault()} onClick={() => onPick(e.code)}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-[12px] ${i === active ? 'bg-white/[0.12] text-white' : 'text-ink-300 hover:bg-white/[0.07]'}`}>
          <img src={e.url} alt="" className="h-6 max-w-[36px]" />
          {e.code}
        </button>
      ))}
      <span className="ml-1 shrink-0 text-[10.5px] text-ink-500">Tab</span>
    </div>
  )
}

/** One emote inside a message. */
export function Emote({ e, size = 28 }) {
  const [gone, setGone] = useState(false)
  if (gone) return <>{e.code}</>
  return <img src={e.url} alt={e.code} title={e.code} loading="lazy" onError={() => setGone(true)} className="inline-block align-middle" style={{ height: size, maxWidth: size * 2.2, margin: '-4px 1px' }} />
}

function TabBtn({ on, onClick, children }) {
  return <button type="button" onClick={onClick} className={`h-7 shrink-0 rounded-md px-2 text-[11.5px] font-semibold ${on ? 'bg-white/[0.12] text-white' : 'text-ink-400 hover:text-white'}`}>{children}</button>
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null
/** 1-3 when the message is only emojis (shown big), else 0. */
export function emojiOnly(text) {
  const t = text.trim()
  if (!t || t.length > 40) return 0
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u.test(t)) return 0
  const n = segmenter ? [...segmenter.segment(t.replace(/\s+/g, ''))].length : 1
  return n <= 3 ? n : 0
}

// ------------------------------------------------------------------ link previews
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
const IMAGE_HOSTS = /^(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com|i\.imgur\.com|cdn\.discordapp\.com|media\.discordapp\.net)$/i

export function imageUrl(url) {
  try {
    const u = new URL(url)
    if (/\.(gif|png|jpe?g|webp|avif)$/i.test(u.pathname) || IMAGE_HOSTS.test(u.hostname) && /\.(gif|webp|mp4|png|jpe?g)$/i.test(u.pathname)) return url
  } catch { /* not a url */ }
  return null
}

export function youtubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

/** True when the message is nothing but one picture link (then the link text is hidden). */
export function onlyImage(body) {
  const t = body.trim()
  return !/\s/.test(t) && !!imageUrl(t)
}

// ------------------------------------------------------------------ YouTube
// Embedded player with our own volume bar (YouTube's slider is tiny in a chat).
// Steered through the player's own message interface (enablejsapi); the volume
// you set is kept and applied to every video.
const YT = 'https://www.youtube-nocookie.com'
const loadYtVol = () => { try { return { volume: 60, muted: false, ...JSON.parse(localStorage.getItem('auch.ytVolume') || '{}') } } catch { return { volume: 60, muted: false } } }

export function YouTubePlayer({ yt, fill = false, className = '', children }) {
  const frame = useRef(null)
  const [vol, setVol] = useState(loadYtVol)
  const now = useRef(vol)
  now.current = vol
  const send = (func, args = []) => { try { frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), YT) } catch { /* not there yet */ } }
  const apply = v => { send('setVolume', [v.volume]); send(v.muted ? 'mute' : 'unMute') }
  const change = v => {
    setVol(v)
    try { localStorage.setItem('auch.ytVolume', JSON.stringify(v)) } catch { /* blocked */ }
    apply(v)
  }
  // the player takes commands once it is ready: say it a few times after loading
  const loaded = () => { for (const ms of [300, 900, 1800, 3500]) setTimeout(() => apply(now.current), ms) }
  const shown = vol.muted ? 0 : vol.volume
  return (
    <span className={`flex flex-col overflow-hidden bg-black ${className}`}>
      <iframe ref={frame} onLoad={loaded} title="YouTube" src={`${YT}/embed/${yt}?autoplay=1&rel=0&enablejsapi=1`} referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className={`w-full border-0 ${fill ? 'min-h-0 flex-1' : 'aspect-video'}`} />
      <span className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => change({ ...vol, muted: !vol.muted && vol.volume > 0 ? true : false, volume: vol.volume || 50 })}
          title={shown ? 'Stumm' : 'Ton an'} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white hover:bg-white/10">
          {shown ? <Volume2 size={15} /> : <VolumeX size={15} className="text-rose-300" />}
        </button>
        <input type="range" min={0} max={100} step={1} value={shown} aria-label="Lautstärke"
          onChange={e => change({ volume: Number(e.target.value), muted: false })}
          className="h-1 min-w-[60px] flex-1 cursor-pointer accent-[#ff0033]" style={{ maxWidth: 220 }} />
        <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-white/60">{shown}%</span>
        {children && <span className="ml-auto flex shrink-0 gap-1">{children}</span>}
      </span>
    </span>
  )
}

/** The video big, over everything (launcher window / website). Esc or a click next to it closes. */
function YouTubeBig({ yt, onClose }) {
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const btn = 'shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-white hover:bg-white/20'
  return createPortal(
    <div data-hit className="fixed inset-0 z-[90] grid place-items-center bg-black/85 p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[min(1280px,92vw)] overflow-hidden rounded-xl shadow-lift">
        <YouTubePlayer yt={yt}>
          <button type="button" className={btn} onClick={() => api.openLink(`https://www.youtube.com/watch?v=${yt}`).catch(() => {})}>Im Browser</button>
          <button type="button" className={btn} onClick={onClose}>Schließen</button>
        </YouTubePlayer>
      </div>
    </div>,
    document.body,
  )
}

/** A YouTube link: plays right here in the chat (click), bigger via the small button. */
function YouTubeCard({ yt, onBig, onFail }) {
  const [play, setPlay] = useState(false)
  const [big, setBig] = useState(false)
  const btn = 'shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[10.5px] text-white hover:bg-white/20'
  // "Groß": the overlay's media window if there is one, else the big player here
  const grow = () => { setPlay(false); if (!onBig || !onBig(`https://www.youtube.com/watch?v=${yt}`)) setBig(true) }
  return (
    <>
      {play ? (
        <span className="mt-1 block w-[360px] max-w-full overflow-hidden rounded-xl">
          <YouTubePlayer yt={yt}>
            <button type="button" onClick={grow} title="Groß ansehen" className={btn}>Groß</button>
            <button type="button" onClick={() => setPlay(false)} title="Video schließen" className={btn}>Zu</button>
          </YouTubePlayer>
        </span>
      ) : (
        <button type="button" onClick={() => setPlay(true)} title="Abspielen" className="group relative mt-1 block w-60 max-w-full overflow-hidden rounded-xl">
          <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onFail} className="aspect-video w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/25 transition group-hover:bg-black/10">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ff0033] text-white shadow-lg"><Play size={18} fill="currentColor" /></span>
          </span>
        </button>
      )}
      {big && <YouTubeBig yt={yt} onClose={() => setBig(false)} />}
    </>
  )
}

export function LinkPreview({ body }) {
  const [failed, setFailed] = useState(false)
  const urls = body.match(URL_RE) || []
  const img = urls.map(imageUrl).find(Boolean)
  const yt = !img && urls.map(youtubeId).find(Boolean)
  if (failed || (!img && !yt)) return null
  if (img) {
    return (
      <button type="button" onClick={() => api.openLink(img).catch(() => {})} className="mt-1 block overflow-hidden rounded-xl bg-white/[0.04]">
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-60 max-w-full object-contain" />
      </button>
    )
  }
  return <YouTubeCard yt={yt} onFail={() => setFailed(true)} />
}

// ------------------------------------------------------------------ invites
const SITE = 'https://auchgit.github.io/'
const artUrl = game => (!game?.art ? null : /^https:\/\//.test(game.art) ? game.art : SITE + game.art)

/** Button next to the message field: pick a game and invite the chat. */
export function InviteButton({ onError, convId }) {
  const games = useLauncher(s => s.catalog.games)
  const playing = useSocial(s => s.game)
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  if (!games?.length) return null
  const sorted = [...games].sort((a, b) => (b.name === playing) - (a.name === playing))
  async function invite(g) {
    setOpen(false)
    try { await useSocial.getState().sendInvite({ ...g, artUrl: artUrl(g) }, convId) } catch (e) { onError?.(e.message) }
  }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} title="Zum Zocken einladen"
        className={`grid h-8 w-8 place-items-center rounded-lg transition ${open ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.07] hover:text-white'}`}>
        <Gamepad2 size={17} />
      </button>
      {open && (
        <div className="card absolute bottom-full left-0 z-40 mb-2 w-56 bg-ink-800/95 p-1.5 shadow-lift">
          <div className="label px-2.5 pb-1 pt-1.5">Einladen zu</div>
          {sorted.map(g => (
            <button key={g.id} type="button" onClick={() => invite(g)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.07]">
              <span className="h-6 w-10 shrink-0 rounded bg-cover bg-center" style={{ backgroundImage: artUrl(g) ? `url(${artUrl(g)})` : undefined, backgroundColor: g.accent || '#333' }} />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {g.name === playing && <span className="text-[10.5px] text-brand-300">läuft</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** An invite in the chat: game art, who invites, and a button to join. */
export function InviteCard({ m, mine, who }) {
  const p = m.payload || {}
  const game = useLauncher(s => s.catalog.games.find(g => g.id === p.game))
  const installed = useLauncher(s => (game && typeof s.play === 'function' ? gameState(s, game.id).installed : null))
  const accent = p.accent || game?.accent || '#6d5dfc'
  const art = p.art || artUrl(game)
  function join() {
    const l = useLauncher.getState()
    if (l.joinElsewhere) { l.joinElsewhere(p.game); return }
    if (typeof l.play !== 'function') { window.open(`/spiele/${p.game}/`, '_self'); return }
    if (installed) l.play(p.game)
    else l.openModal({ type: 'install', id: p.game })
  }
  return (
    <div className="w-60 max-w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850" style={{ boxShadow: `0 10px 30px -16px ${accent}` }}>
      <div className="relative h-24 bg-cover bg-center" style={{ backgroundImage: art ? `url(${art})` : undefined, backgroundColor: accent }}>
        <div className="absolute inset-0 bg-gradient-to-t from-ink-850 via-ink-850/30 to-transparent" />
        <div className="absolute bottom-2 left-3 right-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/70">{mine ? 'Du lädst ein' : `${who} lädt ein`}</div>
          <div className="truncate font-display text-base font-semibold text-white">{p.name || 'Ein Spiel'}</div>
        </div>
      </div>
      {!mine && (
        <div className="p-2.5">
          <button onClick={join} className="flex h-9 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-white transition hover:brightness-110" style={{ background: accent }}>
            <Gamepad2 size={15} />
            {installed === null ? 'Im Launcher mitspielen' : installed ? 'Mitspielen' : 'Installieren'}
          </button>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ pictures + videos
/** A picture or video someone uploaded; loads through a short-lived members-only link. */
export function MediaMessage({ m }) {
  const p = m.payload || {}
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const [big, setBig] = useState(false)
  useEffect(() => {
    let alive = true
    useSocial.getState().mediaUrl(p.path).then(u => { if (alive) (u ? setUrl(u) : setFailed(true)) })
    return () => { alive = false }
  }, [p.path])
  // Reserve the space up front so the chat doesn't jump while it loads.
  const ratio = p.w && p.h ? p.w / p.h : 4 / 3
  const width = Math.min(260, Math.round(220 * Math.max(0.6, Math.min(ratio, 1.6))))
  const box = { width, aspectRatio: String(ratio) }
  if (failed) return <div className="rounded-2xl bg-white/[0.05] px-3 py-2 text-[12px] text-ink-400">{p.type === 'video' ? 'Video' : 'Bild'} nicht mehr verfügbar</div>
  if (!url) return <div className="animate-pulse rounded-2xl bg-white/[0.06]" style={box} />
  if (p.type === 'video') {
    return <video src={url} controls preload="metadata" className="rounded-2xl bg-black" style={{ ...box, maxWidth: '100%' }} />
  }
  return (
    <>
      <button type="button" onClick={() => setBig(true)} className="block overflow-hidden rounded-2xl bg-white/[0.04]" style={{ ...box, maxWidth: '100%' }}>
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      </button>
      {big && (
        <div className="fixed inset-0 z-[60] grid cursor-zoom-out place-items-center bg-black/90 p-6" onClick={() => setBig(false)}>
          <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  )
}

/** Paper clip next to the message field: pick a picture or video. */
export function AttachButton({ onFile, busy }) {
  const input = useRef(null)
  useEffect(() => {
    const el = input.current
    const done = () => { window.__auchPicking = false }
    el?.addEventListener('cancel', done)
    return () => el?.removeEventListener('cancel', done)
  }, [])
  return (
    <>
      <button type="button" onClick={() => { window.__auchPicking = true; input.current?.click() }} disabled={busy} title="Bild oder Video schicken"
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={17} />}
      </button>
      {/* __auchPicking: the file dialog is open, so the overlay doesn't fold up when it takes the focus. */}
      <input ref={input} type="file" accept="image/*,video/mp4,video/webm" hidden
        onChange={e => { window.__auchPicking = false; const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
    </>
  )
}

// ------------------------------------------------------------------ GIF search (KLIPY, GIPHY as stand-in)
// Public client keys (VITE_ in the launcher, PUBLIC_ on the website). KLIPY
// (what Discord added after Tenor's API shut down, finds more memes) when its
// key is there; GIPHY only without it; no key, no GIF button.
const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY || import.meta.env.PUBLIC_GIPHY_KEY || ''
const KLIPY_KEY = import.meta.env.VITE_KLIPY_KEY || import.meta.env.PUBLIC_KLIPY_KEY || ''

async function giphy(q) {
  const base = 'https://api.giphy.com/v1/gifs/'
  const params = new URLSearchParams({ api_key: GIPHY_KEY, limit: '24', rating: 'pg-13', bundle: 'messaging_non_clips' })
  if (q) { params.set('q', q); params.set('lang', 'de') }
  const r = await fetch(`${base}${q ? 'search' : 'trending'}?${params}`)
  if (!r.ok) throw new Error('GIF-Suche gerade nicht erreichbar.')
  const { data } = await r.json()
  return (data || []).map(g => ({
    id: g.id,
    preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
    url: g.images?.downsized_medium?.url || g.images?.original?.url,
    w: Number(g.images?.fixed_width_small?.width) || 100,
    h: Number(g.images?.fixed_width_small?.height) || 100,
  })).filter(g => g.preview && g.url)
}

/** KLIPY wants an anonymous id per device (no account data). */
function klipyCustomer() {
  try {
    let id = localStorage.getItem('auch.klipyCustomer')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('auch.klipyCustomer', id) }
    return id
  } catch { return 'auch-anon' }
}

async function klipy(q) {
  const params = new URLSearchParams({ page: '1', per_page: '24', customer_id: klipyCustomer(), locale: 'de' })
  if (q) params.set('q', q)
  const r = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_KEY)}/gifs/${q ? 'search' : 'trending'}?${params}`)
  if (!r.ok) throw new Error('GIF-Suche gerade nicht erreichbar.')
  const json = await r.json()
  return (json?.data?.data || [])
    .filter(g => g?.type !== 'ad' && g?.file)
    .map(g => {
      const small = g.file.sm?.gif || g.file.xs?.gif
      const big = g.file.md?.gif?.size < 8e6 ? g.file.md.gif : g.file.sm?.gif || g.file.hd?.gif
      return { id: String(g.id), preview: small?.url, url: big?.url, w: Number(small?.width) || 100, h: Number(small?.height) || 100 }
    })
    .filter(g => g.preview && g.url)
}

// KLIPY when its key is there (more memes); GIPHY only stands in without it.
const SOURCES = KLIPY_KEY
  ? [{ id: 'klipy', label: 'KLIPY', key: KLIPY_KEY, search: klipy }]
  : GIPHY_KEY ? [{ id: 'giphy', label: 'GIPHY', key: GIPHY_KEY, search: giphy }] : []

export function GifButton({ onPick }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState({}) // source id -> { items } | { error }
  const box = useRef(null)
  const timer = useRef(null)
  const seq = useRef(0)
  useEffect(() => {
    if (!open) return
    const off = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  useEffect(() => {
    if (!open || !SOURCES.length) return
    clearTimeout(timer.current)
    const n = ++seq.current
    setResults({})
    timer.current = setTimeout(() => {
      for (const s of SOURCES) {
        s.search(q.trim())
          .then(items => { if (seq.current === n) setResults(r => ({ ...r, [s.id]: { items } })) })
          .catch(e => { if (seq.current === n) setResults(r => ({ ...r, [s.id]: { error: e.message } })) })
      }
    }, q ? 350 : 0)
    return () => clearTimeout(timer.current)
  }, [open, q])
  if (!SOURCES.length) return null
  const pick = url => { setOpen(false); setQ(''); onPick(url) }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} title="GIF"
        className={`grid h-8 w-8 place-items-center rounded-lg text-[10.5px] font-bold tracking-wide transition ${open ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.07] hover:text-white'}`}>
        GIF
      </button>
      {open && (
        <div className="card absolute bottom-full right-0 z-40 mb-2 flex w-[310px] flex-col bg-ink-800/95 p-2 shadow-lift">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="GIFs suchen"
            className="mb-2 h-9 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[13px] text-white outline-none focus-visible:outline-none placeholder:text-ink-500 focus:border-brand-400" />
          <div className="h-72 overflow-y-auto">
            {SOURCES.map((s, i) => {
              const r = results[s.id]
              return (
                <section key={s.id} className={i ? 'mt-2 border-t border-white/[0.06] pt-2' : ''}>
                  <div className="mb-1.5 flex items-center justify-between px-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                    <span>{s.label}</span><span>Powered by {s.label}</span>
                  </div>
                  {!r && <div className="grid h-16 place-items-center text-ink-500"><Loader2 size={16} className="animate-spin" /></div>}
                  {r?.error && <p className="px-1 pb-1 text-[12px] text-rose-200">{r.error}</p>}
                  {r?.items?.length === 0 && <p className="px-1 pb-1 text-[12px] text-ink-400">Nix gefunden.</p>}
                  {r?.items?.length > 0 && (
                    <div className="columns-2 gap-1.5">
                      {r.items.map(g => (
                        <button key={g.id} type="button" onClick={() => pick(g.url)}
                          className="mb-1.5 block w-full overflow-hidden rounded-lg bg-white/[0.04] hover:ring-2 hover:ring-brand-400">
                          <img src={g.preview} alt="" loading="lazy" className="w-full" style={{ aspectRatio: `${g.w} / ${g.h}` }} />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
