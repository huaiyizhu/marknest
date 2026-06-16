# Azure Front Door Acceleration

Marknest production now uses Azure Front Door Standard in front of the Azure App Service origin.

## Current Resources

- Resource group: `marknest-prod-rg`
- Front Door profile: `marknest-frontdoor`
- Front Door endpoint: `marknest-global-608633`
- Front Door hostname: `marknest-global-608633-cre8bpdmejc3ejhz.z03.azurefd.net`
- Origin App Service: `marknest-608633d1-0cda.azurewebsites.net`
- Origin health probe: `/api/health`

## Routing Policy

- `/src/*`, `/node_modules/*`, `/uploads/*`: forwards to App Service over HTTPS with Front Door caching and compression enabled.
- `/` and `/*`: handled by the `application` route, forwarded to App Service over HTTPS with no Front Door caching. This serves the app shell, `/api/*`, `/.auth/*`, and any future app routes.
- HTTP requests are redirected to HTTPS.
- Origin Host header is `blog.huaiyiz.com` so app authentication and generated public URLs stay on the final custom domain.

## DNS Change Required

In the DNS provider for `huaiyiz.com`, update:

```text
blog.huaiyiz.com CNAME marknest-global-608633-cre8bpdmejc3ejhz.z03.azurefd.net
```

After DNS propagates, add the Front Door custom domain for `blog.huaiyiz.com` and enable a managed certificate:

```bash
az afd custom-domain create \
  --resource-group marknest-prod-rg \
  --profile-name marknest-frontdoor \
  --custom-domain-name blog-huaiyiz-com \
  --host-name blog.huaiyiz.com \
  --minimum-tls-version TLS12 \
  --certificate-type ManagedCertificate
```

Then associate the custom domain with the `application` and `static-assets` routes.
