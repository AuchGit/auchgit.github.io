// Soundboard: your own short sounds for calls. Starts empty; files you upload
// stay in this browser's IndexedDB (only here). Played into the call as their
// own audio line, so everyone sets how loud your soundboard is for them.
const DB = 'auch-board'

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'id' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction('sounds', mode)
    const req = fn(t.objectStore('sounds'))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
  })
}

export const BOARD_MAX_BYTES = 3 * 1024 * 1024
export const BOARD_MAX_SOUNDS = 40
export const BOARD_MAX_SECONDS = 20 // longer files stop here when played

/** [{ id, name }] in upload order. */
export async function listBoard() {
  const all = (await tx('readonly', s => s.getAll())) || []
  return all.sort((a, b) => (a.at || 0) - (b.at || 0)).map(({ id, name }) => ({ id, name }))
}

/** Keeps an audio file. Throws with a message for the player when it can't. */
export async function addBoard(file) {
  if (!/^audio\//.test(file.type) && !/\.(mp3|ogg|wav|m4a|webm|flac|opus)$/i.test(file.name)) throw new Error(`${file.name}: keine Audio-Datei.`)
  if (file.size > BOARD_MAX_BYTES) throw new Error(`${file.name}: zu groß (bis 3 MB).`)
  if ((await listBoard()).length >= BOARD_MAX_SOUNDS) throw new Error(`Mehr als ${BOARD_MAX_SOUNDS} Sounds gehen nicht. Lösch erst einen.`)
  const data = await file.arrayBuffer()
  await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data.slice(0)).catch(() => { throw new Error(`${file.name}: lässt sich nicht abspielen. MP3, OGG oder WAV gehen.`) })
  const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 32) || 'Sound'
  await tx('readwrite', s => s.put({ id, name, data, at: Date.now() }))
  return { id, name }
}

export async function removeBoard(id) {
  await tx('readwrite', s => s.delete(id))
}

/** The file's bytes (ArrayBuffer) or null. */
export async function boardData(id) {
  const r = await tx('readonly', s => s.get(id))
  return r?.data || null
}
