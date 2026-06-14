# Marknest

Marknest is a personal Markdown blog platform for writing, publishing, managing, and sharing technical articles.

This v1 runs as a dependency-free Node.js application with a REST API and SQLite persistence:

- Microsoft Account and Google Account through Azure App Service Easy Auth
- Local development identities for testing without provider credentials
- Admin assignment through an environment-backed identity whitelist
- Markdown upload, editing, preview, draft save, and publishing
- Article list and article detail rendering
- Article stats for views, likes, comments, and shares
- Share helpers for link copy, QR placeholder, WeChat Moments, and Xiaohongshu
- Server-side authorization for users, articles, comments, and the admin dashboard
- Chinese and English UI localization

## Run Locally

```powershell
npm start
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

Admin identity matching uses provider plus provider user id.

```powershell
$env:ADMIN_IDENTITIES="microsoft:demo-admin,google:another-admin"
```

Azure deployment instructions are in `docs/azure-deployment.md`.
