# Marknest

Marknest is a personal Markdown blog platform for writing, publishing, managing, and sharing technical articles.

This v1 is a dependency-free static prototype that demonstrates the core product flows:

- Third-party account sign-in simulation for Microsoft Account and Google Account
- Admin assignment through an identity whitelist
- Markdown upload, editing, preview, draft save, and publishing
- Article list and article detail rendering
- Article stats for views, likes, comments, and shares
- Share helpers for link copy, QR placeholder, WeChat Moments, and Xiaohongshu
- Basic admin dashboard for all users, articles, comments, and deployment status

## Run Locally

Open `index.html` directly in a browser, or serve the folder with any static web server.

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Test

```powershell
npm test
```

The tests use Node.js built-in modules only.

## Product Document

The first product requirement document is in:

```text
docs/product-requirements.md
```

## Admin Whitelist

For this v1 prototype, admin identity matching is implemented in `src/app.js` with provider plus provider user id.

Example:

```js
const ADMIN_IDENTITIES = new Set(["microsoft:demo-admin"]);
```

In production, this should move to environment-backed server configuration, for example `ADMIN_IDENTITIES=microsoft:xxx,google:yyy`.

