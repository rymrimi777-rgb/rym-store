# RYM Store
React + TypeScript + Tailwind v4, static build for Cloudflare Pages.
- Build: `npm run build` -> `dist` (Pages: build command `npm run build`, output `dist`). `public/_redirects` handles SPA routing.
- Catalog: `src/data/products.json` is the single source of truth. A download appears only if it exists in `downloads`.
- Downloads: upload files to a GitHub Release, paste the asset URL (https://github.com/USER/REPO/releases/download/TAG/FILE) into `downloads`.
- Admin (private): `/admin` runs Decap CMS, which commits to products.json in your repo. Only GitHub users with write access can log in; no database, no public publishing. Setup: create a GitHub OAuth App, deploy a free Cloudflare Worker OAuth proxy (e.g. sterlingwes/decap-proxy), set `base_url` and `repo` in `public/admin/config.yml`. Every save triggers a Pages rebuild.
