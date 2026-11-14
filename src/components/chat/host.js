// Where the call shows on the website (the launcher has its own host.js with
// the same exports):
//   dock  the panel in a corner (drag it where you like)
//   big   the call over the chat
//   full  the browser full screen
//   pip   picture in picture: a small window that stays on top (Chrome, Edge)
import { createPortal } from 'react-dom'
import { useCall } from './useCall'

export const CAN = {
  pip: typeof window !== 'undefined' && 'documentPictureInPicture' in window,
  full: typeof document !== 'undefined' && !!document.fullscreenEnabled,
}

export const useCallView = () => useCall(s => s.view || 'dock')

let before = 'dock' // where full screen / picture in picture go back to
let pipWin = null

function closePip() {
  if (!pipWin) return
  const w = pipWin
  pipWin = null
  w.close()
}

/** The page's styles into the picture-in-picture window. */
function copyStyles(doc) {
  for (const el of document.querySelectorAll('link[rel="stylesheet"], style')) doc.head.appendChild(el.cloneNode(true))
  doc.documentElement.style.background = getComputedStyle(document.documentElement).backgroundColor
  doc.body.style.margin = '0'
}

// Called right from a click: full screen and picture in picture need that.
export async function setCallView(next) {
  const cur = useCall.getState().view || 'dock'
  if (next === cur) return
  if (next === 'full') {
    try { await document.documentElement.requestFullscreen() } catch { useCall.setState({ error: 'Vollbild geht hier nicht.' }); return }
  } else if (cur === 'full' && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  }
  if (next === 'pip') {
    if (!CAN.pip) { useCall.setState({ error: 'Bild im Bild können Chrome und Edge, hier leider nicht.' }); return }
    try {
      const w = await window.documentPictureInPicture.requestWindow({ width: 440, height: 300 })
      copyStyles(w.document)
      w.addEventListener('pagehide', () => { if (pipWin === w) { pipWin = null; useCall.setState({ view: before, pipBody: null }) } })
      pipWin = w
      useCall.setState({ pipBody: w.document.body })
    } catch {
      useCall.setState({ error: 'Bild im Bild hat nicht geklappt.' })
      return
    }
  } else if (cur === 'pip') {
    closePip()
  }
  if (cur === 'dock' || cur === 'big') before = cur
  useCall.setState({ view: next, ...(next === 'pip' ? {} : { pipBody: null }) })
}

/** Out of full screen / picture in picture, back to where you were. */
export const viewBack = () => setCallView(before)

/** Picture in picture renders into its own little window. */
export function PipHost({ children }) {
  const body = useCall(s => s.pipBody)
  return body ? createPortal(children, body) : null
}

if (typeof document !== 'undefined') {
  // Esc in the browser's full screen
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && useCall.getState().view === 'full') useCall.setState({ view: before })
  })
}

// The call ends: everything back to normal.
useCall.subscribe((s, p) => {
  if (p.call && !s.call) {
    closePip()
    if (typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen().catch(() => {})
    if (s.view !== 'dock' || s.pipBody) useCall.setState({ view: 'dock', pipBody: null })
  }
})
