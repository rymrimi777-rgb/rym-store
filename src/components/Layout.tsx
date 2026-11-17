import { NavLink, Link, useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
const nav = [['/apps', 'Applications'], ['/games', 'Games'], ['/updates', 'Updates'], ['/about', 'About']]
export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only p-2">Skip to content</a>
      <header className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-5 flex flex-wrap items-baseline justify-between gap-3">
          <Link to="/" className="font-display text-2xl font-semibold tracking-tight">RYM <span className="font-sans text-xs font-normal text-muted ml-2 hidden sm:inline">Independent Digital Products</span></Link>
          <nav aria-label="Main" className="flex gap-6 text-sm">
            {nav.map(([to, l]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'text-rose' : 'text-muted hover:text-ink'}>{l}</NavLink>)}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-line mt-24 py-8 text-sm text-muted">
        <div className="mx-auto max-w-6xl px-5 flex flex-wrap justify-between gap-2"><span>© {new Date().getFullYear()} RYM</span><a className="hover:text-ink" href="https://rym-portfolio2.pages.dev/">Portfolio</a></div>
      </footer>
    </div>
  )
}
