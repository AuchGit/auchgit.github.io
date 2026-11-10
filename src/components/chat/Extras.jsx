// Chat extras: emoji picker, previews for image / GIF / YouTube links, game invites.
import { useEffect, useRef, useState } from 'react'
import { Gamepad2, Play, Smile } from 'lucide-react'
import { gameState, useLauncher } from './shim'
import { useSocial } from './useSocial'
import { api } from './shim'

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

export function EmojiButton({ onPick }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(() => (loadRecent().length ? -1 : 0))
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const recent = loadRecent()
  const list = tab === -1 ? recent : SETS[tab][1]
  function pick(e) {
    try { localStorage.setItem(RECENT, JSON.stringify([e, ...recent.filter(x => x !== e)].slice(0, 24))) } catch { /* ignore */ }
    onPick(e)
  }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} title="Emoji"
        className={`grid h-8 w-8 place-items-center rounded-lg transition ${open ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.07] hover:text-white'}`}>
        <Smile size={17} />
      </button>
      {open && (
        <div className="card absolute bottom-full right-0 z-40 mb-2 w-[300px] bg-ink-800/95 p-2 shadow-lift">
          <div className="mb-1.5 flex gap-1 overflow-x-auto">
            {recent.length > 0 && <TabBtn on={tab === -1} onClick={() => setTab(-1)}>Zuletzt</TabBtn>}
            {SETS.map(([name], i) => <TabBtn key={name} on={tab === i} onClick={() => setTab(i)}>{name}</TabBtn>)}
          </div>
          <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
            {list.map(e => (
              <button key={e} type="button" onClick={() => pick(e)} className="grid h-9 place-items-center rounded-lg text-[20px] leading-none hover:bg-white/[0.08]">{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
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
  const link = `https://www.youtube.com/watch?v=${yt}`
  return (
    <button type="button" onClick={() => api.openLink(link).catch(() => {})} className="group relative mt-1 block w-60 max-w-full overflow-hidden rounded-xl">
      <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="aspect-video w-full object-cover" />
      <span className="absolute inset-0 grid place-items-center bg-black/25 transition group-hover:bg-black/10">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#ff0033] text-white shadow-lg"><Play size={18} fill="currentColor" /></span>
      </span>
    </button>
  )
}

// ------------------------------------------------------------------ invites
const SITE = 'https://auchgit.github.io/'
const artUrl = game => (!game?.art ? null : /^https:\/\//.test(game.art) ? game.art : SITE + game.art)

/** Button next to the message field: pick a game and invite the chat. */
export function InviteButton({ onError }) {
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
    try { await useSocial.getState().sendInvite({ ...g, artUrl: artUrl(g) }) } catch (e) { onError?.(e.message) }
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
