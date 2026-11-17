import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import type { Product, Download } from '../types'
export function useMeta(title: string, desc?: string) {
  useEffect(() => {
    document.title = title === 'RYM' ? 'RYM — Independent Digital Products' : `${title} — RYM`
    if (desc) document.querySelector('meta[name=description]')?.setAttribute('content', desc)
  }, [title, desc])
}
export const Icon = ({ p, size = 56 }: { p: Product; size?: number }) => (
  <div aria-hidden style={{ width: size, height: size }} className="grid place-items-center border border-line bg-blush/30 font-display text-xl shrink-0">{p.name[0]}</div>
)
export const Soon = () => <span className="text-xs uppercase tracking-widest text-rose">Coming soon</span>
export function Card({ p }: { p: Product }) {
  return (
    <Link to={`/p/${p.slug}`} className="group block border border-line p-5 transition hover:border-rose rise">
      <div className="flex gap-4"><Icon p={p} />
        <div><h3 className="font-display text-lg group-hover:text-rose">{p.name}</h3><p className="text-xs text-muted">{p.type}</p></div></div>
      <p className="mt-4 text-sm text-muted">{p.tagline}</p>
      {p.status === 'coming-soon' && <div className="mt-4"><Soon /></div>}
    </Link>
  )
}
export const Section = ({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) => (
  <section className="mx-auto max-w-6xl px-5 mt-20">
    <div className="flex items-baseline justify-between border-b border-line pb-3 mb-8"><h2 className="font-display text-2xl">{title}</h2>{to && <Link to={to} className="text-sm text-rose">View all</Link>}</div>
    {children}
  </section>
)
const label: Record<Download['platform'], string> = { android: 'Android APK', windows: 'Windows', linux: 'Linux', web: 'Web app', source: 'Source code' }
export function Downloads({ list }: { list: Download[] }) {
  if (!list.length) return null
  return (
    <ul className="border border-line divide-y divide-line">
      {list.map(d => (
        <li key={d.platform + d.url} className="flex items-center justify-between gap-4 p-4">
          <div><p className="font-medium text-sm">{label[d.platform]}</p><p className="text-xs text-muted">{d.version}{d.size ? ` · ${d.size}` : ''}</p></div>
          <a href={d.url} {...(d.platform === 'web' || d.platform === 'source' ? { target: '_blank', rel: 'noreferrer' } : { download: true })}
            className="bg-ink text-paper px-4 py-2 text-sm hover:bg-rose">{d.platform === 'web' ? 'Open' : d.platform === 'source' ? 'View' : 'Download'}</a>
        </li>
      ))}
    </ul>
  )
}
