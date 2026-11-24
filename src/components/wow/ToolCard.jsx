// In the website chat: a shared WoW build / item / page (payload.tool), or a message that is
// only such a link. Our build links open the talent calculator here (/wow/), others a new tab.
import { Bookmark, BookmarkCheck, ExternalLink } from 'lucide-react'
import { BOX, CLASSES, classify, kindLabel, nameFor, toolLink } from './toolbox'
import { useToolbox } from './useToolbox'

const KIND_COLOR = { build: '#8f82ff', item: '#a335ee', page: '#64748b' }

export default function ToolCard({ m, mine }) {
  const tool = m.payload?.tool || (() => {
    const url = toolLink(m.body)
    if (!url) return null
    const i = classify(url) || {}
    return { url, kind: i.kind || 'page', cls: i.cls || null, title: nameFor(url, '', i) }
  })()
  const kept = useToolbox(s => !!tool && s.saves.some(x => x.url === tool.url))
  if (!tool) return null
  const cls = CLASSES[tool.cls]
  const own = /^https:\/\/auchgit\.github\.io\/wow\//.test(tool.url)
  const href = own ? tool.url.replace('https://auchgit.github.io', '') : tool.url
  return (
    <div className={`flex w-64 max-w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] py-1.5 pl-1.5 pr-1 ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}>
      <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: cls?.color || KIND_COLOR[tool.kind] || KIND_COLOR.page }} />
      <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[12.5px] font-semibold text-white">{tool.title}</div>
        <div className="truncate text-[11px] text-ink-400">{[BOX.name, kindLabel(tool), cls?.name].filter(Boolean).join(' · ')}</div>
      </a>
      <a href={href} target="_blank" rel="noreferrer" title="Öffnen" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-white/[0.07] hover:text-white"><ExternalLink size={13} /></a>
      <button type="button" title={kept ? 'Schon gemerkt' : 'Merken'} onClick={() => !kept && useToolbox.getState().keep({ url: tool.url, title: tool.title })}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${kept ? 'text-brand-300' : 'text-ink-400 hover:bg-white/[0.07] hover:text-white'}`}>
        {kept ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
      </button>
    </div>
  )
}
