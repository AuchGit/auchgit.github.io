// "Clip that": the last minute (or so) of a live as a video file (MP4).
//
// A recorder keeps writing a fragmented MP4 in the background: a head (ftyp + moov),
// then fragments (moof + mdat), each starting with a key picture, about one a second.
// Only the newest fragments are kept. A clip is the head + the fragments of the last
// N seconds, their times moved to start at 0 and the length written into the head
// (players show it and can jump around). The picture first goes through `steady`:
// WebRTC changes the picture size with the line, a recording can't follow that.
// (Copy of the launcher's src/lib/clipper.js.)

const TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4']
const KEEP_EXTRA = 15 // seconds kept beyond the clip length

/** The recording format this browser has (null: no clips here, e.g. Firefox). */
export function clipType() {
  if (typeof MediaRecorder === 'undefined') return null
  return TYPES.find(t => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } }) || null
}

const even = v => Math.max(2, Math.round(v / 2) * 2)

/**
 * A copy of a video track that keeps one size: the first picture's shape, scaled to fit
 * maxW x maxH; later pictures of another size are fitted in. Runs per picture as they
 * come (no timers: keeps going with the window in the background).
 */
function steady(track, maxW, maxH) {
  if (typeof MediaStreamTrackProcessor === 'undefined' || typeof MediaStreamTrackGenerator === 'undefined' || typeof VideoFrame === 'undefined') return { track, stop() {} }
  const proc = new MediaStreamTrackProcessor({ track })
  const gen = new MediaStreamTrackGenerator({ kind: 'video' })
  const reader = proc.readable.getReader()
  const writer = gen.writable.getWriter()
  let cv = null, g = null, W = 0, H = 0, stopped = false
  ;(async () => {
    for (;;) {
      let frame
      try { ({ value: frame } = await reader.read()) } catch { break }
      if (!frame) break
      if (stopped) { frame.close(); break }
      try {
        const fw = frame.displayWidth, fh = frame.displayHeight
        if (!cv) {
          const k = Math.min(maxW / fw, maxH / fh)
          W = even(fw * k); H = even(fh * k)
          cv = new OffscreenCanvas(W, H)
          g = cv.getContext('2d', { alpha: false })
        }
        const k = Math.min(W / fw, H / fh)
        const dw = fw * k, dh = fh * k
        if (dw < W - 1 || dh < H - 1) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H) }
        g.drawImage(frame, (W - dw) / 2, (H - dh) / 2, dw, dh)
        const out = new VideoFrame(cv, { timestamp: frame.timestamp })
        frame.close()
        await writer.write(out) // the generator takes it over
      } catch {
        try { frame.close() } catch { /* closed */ }
      }
    }
  })()
  return { track: gen, stop() { stopped = true; reader.cancel().catch(() => {}); try { gen.stop() } catch { /* stopped */ } } }
}

// ------------------------------------------------------------------ MP4 boxes
const typeAt = (b, at) => String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7])
function children(b, dv, at, end) {
  const out = []
  for (let p = at; p + 8 <= end;) {
    const size = dv.getUint32(p)
    if (size < 8 || p + size > end) break
    out.push({ type: typeAt(b, p), at: p, size })
    p += size
  }
  return out
}

/** Tracks from the head: id -> { timescale, video }. */
function readTracks(head) {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const moov = children(head, dv, 0, head.length).find(x => x.type === 'moov')
  const out = {}
  for (const trak of children(head, dv, moov.at + 8, moov.at + moov.size).filter(x => x.type === 'trak')) {
    const k = children(head, dv, trak.at + 8, trak.at + trak.size)
    const tkhd = k.find(x => x.type === 'tkhd'), mdia = k.find(x => x.type === 'mdia')
    const id = dv.getUint32(tkhd.at + (head[tkhd.at + 8] === 1 ? 28 : 20))
    const m = children(head, dv, mdia.at + 8, mdia.at + mdia.size)
    const mdhd = m.find(x => x.type === 'mdhd'), hdlr = m.find(x => x.type === 'hdlr')
    const timescale = dv.getUint32(mdhd.at + (head[mdhd.at + 8] === 1 ? 28 : 20))
    out[id] = { timescale, video: String.fromCharCode(...head.subarray(hdlr.at + 16, hdlr.at + 20)) === 'vide' }
  }
  return out
}

/** A fragment's tracks: where their start time sits, and how long the fragment runs. */
function readFragment(moof, tracks) {
  const dv = new DataView(moof.buffer, moof.byteOffset, moof.byteLength)
  const tf = []
  for (const traf of children(moof, dv, 8, moof.length).filter(x => x.type === 'traf')) {
    const k = children(moof, dv, traf.at + 8, traf.at + traf.size)
    const tfhd = k.find(x => x.type === 'tfhd'), tfdt = k.find(x => x.type === 'tfdt'), trun = k.find(x => x.type === 'trun')
    if (!tfhd || !tfdt || !trun) continue
    const id = dv.getUint32(tfhd.at + 12)
    const tflags = dv.getUint32(tfhd.at + 8) & 0xffffff
    // tfhd optional fields: base offset, description index, duration, size, flags
    let p = tfhd.at + 16
    if (tflags & 0x01) p += 8
    if (tflags & 0x02) p += 4
    const defDur = tflags & 0x08 ? dv.getUint32(p) : 0
    if (tflags & 0x08) p += 4
    if (tflags & 0x10) p += 4
    const defFlags = tflags & 0x20 ? dv.getUint32(p) : 0
    const v = moof[tfdt.at + 8]
    const time = v === 1 ? Number(dv.getBigUint64(tfdt.at + 12)) : dv.getUint32(tfdt.at + 12)
    const rflags = dv.getUint32(trun.at + 8) & 0xffffff
    const count = dv.getUint32(trun.at + 12)
    let q = trun.at + 16
    if (rflags & 0x01) q += 4
    let first = defFlags
    if (rflags & 0x04) { first = dv.getUint32(q); q += 4 }
    let dur = 0
    for (let i = 0; i < count; i++) {
      if (rflags & 0x100) { dur += dv.getUint32(q); q += 4 } else dur += defDur
      if (rflags & 0x200) q += 4
      if (rflags & 0x400) { if (i === 0 && !(rflags & 0x04)) first = dv.getUint32(q); q += 4 }
      if (rflags & 0x800) q += 4
    }
    const ts = tracks[id]?.timescale || 1000
    tf.push({ id, off: tfdt.at + 12, v, time, start: time / ts, len: dur / ts, video: !!tracks[id]?.video, key: !(first & 0x10000) })
  }
  const lead = tf.find(x => x.video) || tf[0]
  return { tf, t: lead ? lead.start : 0, len: lead ? lead.len : 0, key: lead ? lead.key : true }
}

/** The head with the clip's length in it (mvhd duration + mehd in mvex). */
function headWithLength(head, seconds) {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const top = children(head, dv, 0, head.length)
  const moov = top.find(x => x.type === 'moov')
  const parts = []
  for (const box of top) {
    if (box !== moov) { parts.push(head.slice(box.at, box.at + box.size)); continue }
    const kids = children(head, dv, moov.at + 8, moov.at + moov.size)
    const mvhd = kids.find(x => x.type === 'mvhd')
    const v1 = head[mvhd.at + 8] === 1
    const scale = dv.getUint32(mvhd.at + (v1 ? 28 : 20))
    const length = Math.round(seconds * scale)
    const inner = []
    for (const k of kids) {
      const bytes = head.slice(k.at, k.at + k.size)
      const kv = new DataView(bytes.buffer)
      if (k.type === 'mvhd') {
        if (v1) kv.setBigUint64(32, BigInt(length)); else kv.setUint32(24, Math.min(length, 0xffffffff))
        inner.push(bytes)
      } else if (k.type === 'mvex') {
        const mk = children(head, dv, k.at + 8, k.at + k.size).filter(x => x.type !== 'mehd')
        const mehd = new Uint8Array(16)
        const md = new DataView(mehd.buffer)
        md.setUint32(0, 16); mehd.set([0x6d, 0x65, 0x68, 0x64], 4); md.setUint32(12, Math.min(length, 0xffffffff))
        const rest = mk.map(x => head.slice(x.at, x.at + x.size))
        const size = 8 + 16 + rest.reduce((n, x) => n + x.length, 0)
        const hd = new Uint8Array(8)
        new DataView(hd.buffer).setUint32(0, size); hd.set([0x6d, 0x76, 0x65, 0x78], 4)
        inner.push(hd, mehd, ...rest)
      } else inner.push(bytes)
    }
    const size = 8 + inner.reduce((n, x) => n + x.length, 0)
    const hd = new Uint8Array(8)
    new DataView(hd.buffer).setUint32(0, size); hd.set([0x6d, 0x6f, 0x6f, 0x76], 4)
    parts.push(hd, ...inner)
  }
  return parts
}

/**
 * Starts the background recording of a stream (picture + sound). Returns
 * { cut(seconds) -> Promise<Blob|null>, stop(), type } or null (no clips here).
 * seconds: how much to keep at least; size: the picture's box (it keeps its shape).
 */
export function clipBuffer(stream, { seconds = 60, maxW = 1280, maxH = 720, bitrate = 3_500_000 } = {}) {
  const type = clipType()
  const v = stream.getVideoTracks()[0]
  if (!type || !v) return null
  const pic = steady(v, maxW, maxH)
  const rec0 = new MediaStream([pic.track, ...stream.getAudioTracks()])
  let rec
  try {
    rec = new MediaRecorder(rec0, { mimeType: type, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000, videoKeyFrameIntervalDuration: 1000 })
  } catch {
    pic.stop()
    return null
  }
  let pending = new Uint8Array(0)
  let ftyp = null, head = null, tracks = null, moof = null
  const frags = [] // { moof, mdat, t, len, key, tf }
  let queue = Promise.resolve()
  let dead = false

  const take = bytes => {
    const all = new Uint8Array(pending.length + bytes.length)
    all.set(pending); all.set(bytes, pending.length)
    const dv = new DataView(all.buffer)
    let at = 0
    while (at + 8 <= all.length) {
      let size = dv.getUint32(at)
      if (size === 1) { if (at + 16 > all.length) break; size = Number(dv.getBigUint64(at + 8)) }
      if (size < 8) { dead = true; break } // not what we can read: no clips from this one
      if (at + size > all.length) break
      const box = all.slice(at, at + size)
      const t = typeAt(all, at)
      if (t === 'ftyp') ftyp = box
      else if (t === 'moov') { head = ftyp ? concat(ftyp, box) : box; tracks = readTracks(head) }
      else if (t === 'moof') moof = box
      else if (t === 'mdat' && moof && tracks) {
        frags.push({ moof, mdat: box, ...readFragment(moof, tracks) })
        moof = null
        const newest = frags[frags.length - 1].t
        while (frags.length > 2 && newest - frags[0].t > seconds + KEEP_EXTRA) frags.shift()
      }
      at += size
    }
    pending = all.slice(at)
  }
  rec.ondataavailable = e => {
    if (!e.data?.size) return
    queue = queue.then(async () => { if (!dead) take(new Uint8Array(await e.data.arrayBuffer())) }).catch(() => { dead = true })
  }
  rec.onerror = () => { dead = true }
  rec.start(250)

  return {
    type,
    /** The last `sec` seconds as a playable MP4 (waits a moment for the fragment being written). */
    async cut(sec = seconds) {
      if (dead) return null
      await new Promise(r => setTimeout(r, 1300))
      try { rec.requestData() } catch { /* stopped */ }
      await new Promise(r => setTimeout(r, 150))
      await queue
      if (!head || !frags.length) return null
      const last = frags[frags.length - 1]
      const end = last.t + last.len
      let i = frags.findIndex(f => f.key && f.t >= end - sec - 0.5)
      if (i < 0) i = frags.findIndex(f => f.key)
      if (i < 0) return null
      const keep = frags.slice(i)
      const base = Object.fromEntries(keep[0].tf.map(x => [x.id, x.time]))
      const pieces = keep.map(f => {
        const m = f.moof.slice()
        const dv = new DataView(m.buffer)
        for (const x of f.tf) {
          const t = Math.max(0, x.time - (base[x.id] ?? x.time))
          if (x.v === 1) dv.setBigUint64(x.off, BigInt(t)); else dv.setUint32(x.off, t)
        }
        return [m, f.mdat]
      }).flat()
      return new Blob([...headWithLength(head, end - keep[0].t), ...pieces], { type: 'video/mp4' })
    },
    stop() {
      try { if (rec.state !== 'inactive') rec.stop() } catch { /* stopped */ }
      pic.stop()
      frags.length = 0
      pending = new Uint8Array(0)
    },
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a); out.set(b, a.length)
  return out
}

/** "Clip Pascal 2026-11-22 14-05-33.mp4" */
export function clipName(who) {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  const safe = String(who || 'Live').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 40) || 'Live'
  return `Clip ${safe} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.mp4`
}

/** In a browser: as a download. */
export function downloadClip(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return { path: null }
}
