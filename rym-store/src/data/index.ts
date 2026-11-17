import raw from './products.json'
import type { Product } from '../types'
export const products = raw.products as Product[]
export const bySlug = (s?: string) => products.find(p => p.slug === s)
export const updates = products
  .flatMap(p => p.changelog.map(r => ({ ...r, product: p })))
  .sort((a, b) => b.date.localeCompare(a.date))
