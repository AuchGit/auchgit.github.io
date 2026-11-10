// "Why bother with an account?" in three short points. Shown wherever someone
// is asked to sign up, so nobody has to guess what they get.
const POINTS = [
  { t: 'Leute adden', d: 'Per Freundescode oder Spielername.' },
  { t: 'Bald: chatten', d: 'Und sehen, wer gerade was zockt. Kommt als Nächstes.' },
  { t: 'NerdShelf gleich mit', d: 'Ein Account, überall eingeloggt.' },
]

export default function WhyAccount({ className = 'mb-6' }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="font-semibold text-white">Wofür ein Account?</div>
      <ul className="mt-3 space-y-2.5">
        {POINTS.map(p => (
          <li key={p.t} className="flex gap-3 text-sm">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/20 text-brand-300">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            <span><span className="font-semibold text-white">{p.t}.</span> <span className="text-ink-300">{p.d}</span></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
