// One Supabase client for the whole site. Default settings on purpose: the
// session lands in this origin's localStorage under Supabase's default key,
// the same place NerdShelf (auchgit.github.io/NerdShelf/) looks for it, so
// signing in here signs you in there too.
import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const url = import.meta.env.PUBLIC_SUPABASE_URL
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY
export const supabase = url && key ? createClient(url, key) : null

/** Where confirmation and reset mails send people back to. */
export const welcomeUrl = () => `${window.location.origin}/willkommen/`
export const resetUrl = () => `${window.location.origin}/konto/?neues-passwort`

/** undefined while loading, null when signed out, else the session. */
export function useSession() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

/** Name and friend code. Falls back to the NerdShelf profile if social isn't set up yet. */
export function useProfile(session) {
  const [profile, setProfile] = useState(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!session) { setProfile(null); return }
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.rpc('social_me')
      if (!alive) return
      if (!error && data?.[0]) { setProfile({ ...data[0], social: true }); return }
      const { data: p } = await supabase.from('profiles').select('player_name').eq('id', session.user.id).maybeSingle()
      if (alive) setProfile({ id: session.user.id, player_name: p?.player_name || '', friend_code: null, social: false })
    })()
    return () => { alive = false }
  }, [session?.user?.id, version])
  return [profile, () => setVersion(v => v + 1)]
}

/** Supabase's English errors in plain German. */
export function germanError(err) {
  const m = String(err?.message || err || '')
  if (/invalid login credentials/i.test(m)) return 'Mail oder Passwort passt nicht. Tippfehler?'
  if (/email not confirmed/i.test(m)) return 'Du musst erst noch deine Mail bestätigen. Guck mal ins Postfach, auch im Spam.'
  if (/already registered|already been registered/i.test(m)) return 'Mit der Mail gibt es schon einen Account. Log dich einfach ein.'
  if (/password should be at least|weak password/i.test(m)) return 'Das Passwort braucht mindestens 6 Zeichen.'
  if (/rate limit|too many/i.test(m)) return 'Ganz schön viele Versuche gerade. Warte kurz und probier es dann nochmal.'
  if (/unable to validate email|invalid email/i.test(m)) return 'Das sieht nicht nach einer Mail-Adresse aus.'
  if (/expired|invalid.*(token|link)|otp/i.test(m)) return 'Der Link ist abgelaufen oder wurde schon benutzt.'
  if (/same password|different from the old/i.test(m)) return 'Das neue Passwort muss anders sein als das alte.'
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Bist du online?'
  return m || 'Da ist was schiefgelaufen.'
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2) || '?').toUpperCase()
}

/** A stable colour per person, from their id. */
export function personColor(id = '') {
  const palette = ['#8f82ff', '#ff6b9d', '#3ec7a5', '#f2a541', '#4fb3ff', '#e26bff', '#ff7a59', '#7bd88f']
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}
