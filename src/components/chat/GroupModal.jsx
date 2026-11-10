import { useState } from 'react'
import { Check, Loader2, Users } from 'lucide-react'
import { useSocial } from './useSocial'
import { useLauncher } from './shim'
import { Modal } from './shim'
import { PersonAvatar } from './Person'

/** New group (no convId) or adding friends to an open group. */
export function GroupModal({ convId }) {
  const close = useLauncher(s => s.closeModal)
  const allFriends = useSocial(s => s.friends)
  const chat = useSocial(s => s.chat)
  const members = (convId && chat?.convId === convId && chat.members) || []
  const friends = allFriends.filter(f => f.relation === 'friend')
  const online = useSocial(s => s.online)
  const { createGroup, addToGroup } = useSocial.getState()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const candidates = friends
    .filter(f => !members.some(m => m.user_id === f.user_id))
    .sort((a, b) => (online[b.user_id] ? 1 : 0) - (online[a.user_id] ? 1 : 0) || a.player_name.localeCompare(b.player_name))
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      if (convId) for (const id of picked) await addToGroup(convId, id)
      else await createGroup(name, picked)
      close()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const ready = picked.length > 0 && (convId || name.trim().length >= 2)

  return (
    <Modal title={convId ? 'Leute hinzufügen' : 'Neue Gruppe'} onClose={close} width="max-w-sm" icon={<Users size={20} className="text-brand-300" />}>
      {!convId && (
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} autoFocus placeholder="Name der Gruppe"
          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-sm text-white outline-none focus-visible:outline-none placeholder:text-ink-500 focus:border-brand-400" />
      )}
      <div className={`label ${convId ? '' : 'mt-4'} mb-1.5`}>{convId ? 'Wen noch?' : 'Wer ist dabei?'}</div>
      {candidates.length ? (
        <ul className="-mx-2 max-h-72 overflow-y-auto">
          {candidates.map(f => {
            const on = picked.includes(f.user_id)
            return (
              <li key={f.user_id}>
                <button onClick={() => toggle(f.user_id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-white/[0.05]">
                  <PersonAvatar id={f.user_id} name={f.player_name} url={f.avatar_url} size={32} status={online[f.user_id] ? (online[f.user_id].game ? 'game' : 'online') : null} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{f.player_name}</span>
                  <span className={`grid h-5 w-5 place-items-center rounded-md border transition ${on ? 'border-brand-400 bg-brand-500 text-white' : 'border-white/20'}`}>{on && <Check size={13} strokeWidth={3} />}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-400">{convId ? 'Alle deine Freunde sind schon drin.' : 'Erst ein paar Leute adden, dann klappt das mit der Gruppe.'}</p>
      )}
      {error && <div className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-200">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={close}>Abbrechen</button>
        <button className="btn btn-brand" disabled={!ready || busy} onClick={submit}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          {convId ? 'Hinzufügen' : 'Erstellen'}
        </button>
      </div>
    </Modal>
  )
}
