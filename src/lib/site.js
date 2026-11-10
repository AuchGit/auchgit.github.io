import data from '../data/generated.json'
import config from '../../site.config.json'

export const site = config
export const games = data.games
export const tools = data.tools
export const launcher = data.launcher
export const news = data.news
export const generatedAt = data.generatedAt

export const allProjects = [...data.games, ...data.tools]
export const projectUrl = p => (p.kind === 'tool' ? `/tools/${p.id}/` : p.kind === 'launcher' ? '/launcher/' : `/spiele/${p.id}/`)

export function bytes(n) {
  if (!n) return ''
  if (n < 1048576) return `${Math.round(n / 1024)} KB`
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0).replace('.', ',')} MB`
}

export function date(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function shortDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}

export function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return `rgba(143,130,255,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
