# Security Summary

This project implements layered, best-effort protections for private document viewing on Cloudflare Pages.

## Authentication and Session

- Password gate enforced in Cloudflare Pages middleware (`functions/_middleware.js`).
- Password source: `SITE_PASSWORD` environment variable (not hard-coded in site content).
- Public route policy: only `/__auth` is accessible without an authenticated session.
- All other routes require a valid authenticated session before any content is served.
- Session cookie lifetime: **2 hours** (`lc_auth`, signed token).
- Session cookies:
  - `lc_auth`: signed, `HttpOnly`, `Secure`, `SameSite=Lax`.
  - `lc_auth_exp`: client-readable expiry timestamp for auto-expiry reload behavior.
- Logout endpoint (`/__logout`) clears both auth cookies.

## Session Expiry UX

- Open pages auto-reload when session expires (main dashboard, generated preview pages, PDF preview).
- Reload appends `sessionExpired=1` to trigger middleware login flow.
- Login page shows HTML notice:
  - **"Session has expired. Please log back in."**

## PDF and File Access Controls

- Direct file access under `/files/*` is blocked by middleware (403).
- PDF links are rewritten to preview routes instead of direct file URLs.
- PDF preview page uses PDF.js rendering (canvas), not browser-native PDF chrome.
- Raw PDF endpoint (`/__view/...pdf`) is intended for viewer fetches; direct document/embed navigation is blocked by request destination checks.

## Download/Print/Copy Deterrents (Best Effort)

- Explicit download UI removed from generated preview pages.
- Print deterrence across pages:
  - `Ctrl/Cmd + P` interception.
  - Print stylesheet hides content and shows **"Printing is disabled."**
- Context menu on PDF canvas/image area is blocked (right-click save/copy image options suppressed in viewer).

## Important Limitation

Web content protections are **best effort** only. Determined users can still capture content (e.g., screenshots, external tools, dev tools). These controls reduce casual downloading/printing but are not absolute DRM.
