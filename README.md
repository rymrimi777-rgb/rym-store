# RYM Store

Static store (Cloudflare Pages) + a small admin API (Cloudflare Pages Functions) that edits the catalogue through the GitHub REST API.
Free services only: Cloudflare Pages, GitHub (repo + Releases). No R2, Firebase, Supabase or database.

```
public/            website (build output directory)
  index.html       store (reads data/products.json)
  admin/index.html admin panel  →  https://YOUR-SITE/admin/
  data/products.json  catalogue (edited by the admin through GitHub commits)
  media/<product>/    icons + screenshots (small images only)
functions/api/[[route]].js   → /api/*   (server-side, holds the secrets)
server/            auth, GitHub client, validation
test/              e2e test + local preview (fake GitHub)
```
Application binaries are **never** in the repository: they are GitHub Release assets (`<product>-v<version>` tags).

## 1. Put the project on GitHub
Create a **public** repository (public is required so visitors can download release assets without logging in) and push this folder.

## 2. Create the GitHub token (stays on the server)
GitHub → Settings → Developer settings → Fine-grained tokens → Generate:
- Repository access: **Only select repositories** → your store repo
- Permissions: **Contents: Read and write** (this covers commits and Releases) and Metadata: Read
- Set an expiry you can live with (note the date to renew it).

## 3. Cloudflare Pages
Workers & Pages → Create → Pages → Connect to Git → pick the repo.
- Framework preset: None · Build command: *(empty)* · **Build output directory: `public`**
- Settings → Variables and Secrets (Production), add as **Secret** unless noted:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | the token from step 2 |
| `GITHUB_OWNER` | your GitHub username/org (plain text) |
| `GITHUB_REPO` | the repository name (plain text) |
| `GITHUB_BRANCH` | `main` (plain text, optional) |
| `ADMIN_PASSWORD` | a long passphrase (12+ characters) |
| `SESSION_SECRET` | 40+ random characters, e.g. `openssl rand -hex 32` |
| `MAX_UPLOAD_MB` | optional, default 95 |

Redeploy after adding variables. Then open `/admin/`.

## 4. Strongly recommended: rate-limit the login
Cloudflare dashboard → your domain → Security → WAF → Rate limiting rules (free): URI path equals `/api/login`, 5 requests / 10 seconds → Block. (Sessions are signed HttpOnly cookies, valid 8 h; the API also checks a CSRF header and Origin.)
Optional: protect `/admin/*` with Cloudflare Access (free for up to 50 users).

## How publishing works
Every admin action commits `public/data/products.json` (and images) to your branch; Cloudflare Pages redeploys automatically in about a minute. Releases and binaries are created immediately on GitHub. “Unpublish” hides a product from the store (drafts remain in the repo JSON, so don't put secrets in them).

## Large APK & File Uploads (> 90 MB up to 2 GB)
Cloudflare Pages Functions cap request bodies at **100 MB** (95 MB default). For files larger than 90 MB (such as 190 MB – 500 MB+ APKs):
1. Run the local upload helper on your computer:
   ```bash
   node server/upload-helper.mjs
   ```
2. In the admin dashboard, select your large APK and click **Upload file**. The dashboard automatically streams the binary directly to GitHub Releases via the local helper without passing through Cloudflare.
3. Or upload directly from the command line:
   ```bash
   node server/upload-helper.mjs --file path/to/app.apk --slug my-app --version 1.0.0 --platform Android
   ```

## Limits to know
- Uploads through standard Cloudflare Pages Functions are capped at **95 MB**. Files above 90 MB use the local streaming helper above.
- Allowed binaries: apk, aab, exe, msi, zip, dmg, deb, AppImage, gz, pkg — extension and file signature are both checked. Images: real PNG/JPEG/WebP, max 3 MB, max 8 screenshots (SVG is refused on purpose).
- Cloudflare Pages free: 500 builds/month; each save triggers one deploy.

## Local checks
```
node test/e2e.mjs        # runs the real API handler against a local fake GitHub (23 checks)
node test/dev.mjs 8788   # preview: http://localhost:8788  admin password: local-dev-password (fake GitHub, nothing is sent online)
```
For a real local run with Cloudflare's runtime: create `.dev.vars` with the variables above and run `npx wrangler pages dev public`.
