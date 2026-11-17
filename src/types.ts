export type Platform = 'android' | 'windows' | 'linux' | 'web' | 'source'
export interface Download { platform: Platform; url: string; version: string; size?: string }
export interface Release { version: string; date: string; notes: string[] }
export interface Product {
  slug: string; name: string; tagline: string; description: string
  category: 'app' | 'game'; type: string; featured: boolean
  status: 'released' | 'coming-soon'
  version?: string; releaseDate?: string; size?: string
  requirements: string[]; features: string[]; screenshots: string[]
  changelog: Release[]; downloads: Download[]
}
