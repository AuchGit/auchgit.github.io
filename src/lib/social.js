// Live social data shared by navigation and pages: friend list + what needs attention.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

/** Friends, requests and their count; refreshes live while the page is open. */
export function useFriends(session) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const uid = session?.user?.id

  const load = useCallback(async () => {
    if (!uid) return
    const { data, error } = await supabase.rpc('social_friends')
    if (error) { setError(error); setList([]); return }
    setError(null)
    setList(data || [])
  }, [uid])

  useEffect(() => {
    if (!uid) { setList(null); return }
    load()
    const channel = supabase
      .channel(`friendships-${uid}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'social_friendships' }, () => load())
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(channel); window.removeEventListener('focus', onFocus) }
  }, [uid, load])

  const incoming = (list || []).filter(p => p.relation === 'incoming')
  return { list, error, reload: load, incoming }
}

/** Shows the number of open things in the tab title, e.g. "(2) AuchGit". */
export function useTitleBadge(count) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = count > 0 ? `(${count}) ${base}` : base
  }, [count])
}
