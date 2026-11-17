import { Link, useParams } from 'react-router-dom'
import { products, bySlug, updates } from '../data'
import { Card, Section, Icon, Soon, Downloads, useMeta } from '../components/ui'
import type { Product } from '../types'
const Grid = ({ list }: { list: Product[] }) => <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{list.map(p => <Card key={p.slug} p={p} />)}</div>
const Empty = ({ t }: { t: string }) => <p className="text-muted text-sm">{t}</p>

export function Home() {
  useMeta('RYM')
  const feat = products.filter(p => p.featured && p.category === 'app')
  const games = products.filter(p => p.category === 'game')
  const released = products.filter(p => p.status === 'released')
  return (<>
    <section className="mx-auto max-w-6xl px-5 pt-16 grid md:grid-cols-[1.4fr_1fr] gap-10 items-center">
      <div className="rise"><p className="text-xs uppercase tracking-widest text-muted">Independent Digital Products</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[1.05] mt-4">Software that should feel right to use.</h1>
        <p className="mt-6 max-w-md text-muted">Apps, developer tools and games, made and published by one person. Everything here is mine, and downloads come straight from the source.</p>
        <div className="mt-8 flex gap-3 text-sm"><Link to="/apps" className="bg-ink text-paper px-5 py-3 hover:bg-rose">Browse applications</Link><Link to="/games" className="border border-line px-5 py-3 hover:border-rose">Games</Link></div></div>
      <img src="/images/cloud-waving.png" alt="Pink cloud mascot waving hello" className="w-56 mx-auto" width={240} height={270} />
    </section>
    <Section title="Featured applications" to="/apps"><Grid list={feat} /></Section>
    <Section title="Recently released" to="/apps">{released.length ? <Grid list={released} /> : <Empty t="Nothing released yet." />}</Section>
    <Section title="Games" to="/games"><Grid list={games} /></Section>
    <Section title="Latest updates" to="/updates">{updates.length ? <ul className="space-y-3 text-sm">{updates.slice(0, 4).map(u => <li key={u.product.slug + u.version}><span className="text-muted">{u.date}</span> · <Link className="text-rose" to={`/p/${u.product.slug}`}>{u.product.name} {u.version}</Link></li>)}</ul> : <Empty t="Release notes will appear here." />}</Section>
    <Section title="Explore all products"><Grid list={products} /></Section>
  </>)
}
export function Catalog({ category }: { category: 'app' | 'game' }) {
  const t = category === 'app' ? 'Applications' : 'Games'
  useMeta(t, `${t} by RYM`)
  const list = products.filter(p => p.category === category)
  return <Section title={t}>{list.length ? <Grid list={list} /> : <Empty t="Nothing here yet." />}</Section>
}
export function ProductPage() {
  const p = bySlug(useParams().slug)
  useMeta(p?.name ?? 'Not found', p?.tagline)
  if (!p) return <Section title="Product not found"><Link to="/" className="text-rose">Back home</Link></Section>
  const facts: [string, string | undefined][] = [['Version', p.version ?? p.downloads[0]?.version], ['Released', p.releaseDate], ['File size', p.size ?? p.downloads[0]?.size], ['Platforms', p.downloads.map(d => d.platform).join(', ') || undefined]]
  return (
    <article className="mx-auto max-w-6xl px-5 pt-14 rise">
      <div className="flex gap-5 items-center"><Icon p={p} size={80} />
        <div><h1 className="font-display text-4xl">{p.name}</h1><p className="text-muted">{p.tagline}</p></div></div>
      <div className="mt-10 grid md:grid-cols-[1.6fr_1fr] gap-12">
        <div>
          <p className="leading-relaxed">{p.description}</p>
          <h2 className="font-display text-xl mt-12 mb-4">Screenshots</h2>
          {p.screenshots.length ? <div className="flex gap-4 overflow-x-auto">{p.screenshots.map(s => <img key={s} src={s} loading="lazy" alt={`${p.name} screenshot`} className="h-72 border border-line" />)}</div>
            : <div className="h-40 border border-dashed border-line grid place-items-center text-sm text-muted">Screenshots coming soon</div>}
          <h2 className="font-display text-xl mt-12 mb-4">Features</h2>
          <ul className="list-disc pl-5 space-y-1">{p.features.map(f => <li key={f}>{f}</li>)}</ul>
          {!!p.requirements.length && <><h2 className="font-display text-xl mt-12 mb-4">System requirements</h2><ul className="list-disc pl-5 space-y-1">{p.requirements.map(f => <li key={f}>{f}</li>)}</ul></>}
          <h2 className="font-display text-xl mt-12 mb-4">Changelog</h2>
          {p.changelog.length ? p.changelog.map(r => <div key={r.version} className="mb-6"><h3 className="font-medium">{r.version} <span className="text-muted text-sm font-normal">· {r.date}</span></h3><ul className="list-disc pl-5 text-sm text-muted">{r.notes.map(n => <li key={n}>{n}</li>)}</ul></div>) : <Empty t="No tracked releases yet." />}
        </div>
        <aside className="md:sticky md:top-6 self-start space-y-6">
          {p.downloads.length ? <Downloads list={p.downloads} /> : <div className="border border-line p-5"><Soon /><p className="text-sm text-muted mt-2">No download is available yet.</p></div>}
          <dl className="text-sm divide-y divide-line border border-line">{facts.filter(f => f[1]).map(([k, v]) => <div key={k} className="flex justify-between p-3"><dt className="text-muted">{k}</dt><dd className="capitalize">{v}</dd></div>)}</dl>
        </aside>
      </div>
    </article>
  )
}
export function Updates() {
  useMeta('Updates', 'Release timeline for RYM products')
  return <Section title="Updates">{updates.length ? <ol className="border-l border-line ml-2 space-y-8">{updates.map(u => <li key={u.product.slug + u.version} className="pl-6"><p className="text-xs text-muted">{u.date}</p><Link to={`/p/${u.product.slug}`} className="font-display text-lg text-rose">{u.product.name} {u.version}</Link><ul className="list-disc pl-5 text-sm text-muted mt-1">{u.notes.map(n => <li key={n}>{n}</li>)}</ul></li>)}</ol> : <Empty t="No releases published yet." />}</Section>
}
export function About() {
  useMeta('About')
  return <section className="mx-auto max-w-6xl px-5 pt-16 grid md:grid-cols-[1.4fr_1fr] gap-10 items-center"><div><h1 className="font-display text-4xl">About RYM</h1>
    <p className="mt-6 max-w-lg text-muted leading-relaxed">RYM is the independent studio of Rym, a full-stack developer who believes great software should be both functional and visually meaningful. Every product here is built, designed and published by one person.</p>
    <a className="inline-block mt-6 text-rose" href="https://rym-portfolio2.pages.dev/">See the portfolio</a></div>
    <img src="/images/cloud-walking.png" alt="Pink cloud mascot walking" className="w-56 mx-auto" width={240} height={240} /></section>
}
