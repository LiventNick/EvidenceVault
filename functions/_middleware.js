const AUTH_PATH = "/__auth";
const LOGOUT_PATH = "/__logout";
const PREVIEW_PATH_PREFIX = "/__preview/";
const VIEW_PATH_PREFIX = "/__view/";
const COOKIE_NAME = "lc_auth";
const EXPIRY_COOKIE_NAME = "lc_auth_exp";
const SESSION_EXPIRED_QUERY_PARAM = "sessionExpired";
const SESSION_SECONDS = 2 * 60 * 60;

export async function onRequest(context) {
  const { request, env, next } = context;
  const configuredPassword = String(env.SITE_PASSWORD || "");

  if (!configuredPassword) {
    return new Response("Authentication is not configured. Set SITE_PASSWORD in Cloudflare Pages environment variables.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=UTF-8" }
    });
  }

  const url = new URL(request.url);

  if (url.pathname === AUTH_PATH) {
    if (request.method !== "POST") {
      return renderLoginPage("/", false, false);
    }

    const formData = await request.formData();
    const enteredPassword = String(formData.get("password") || "");
    const redirectPath = sanitizeRedirect(String(formData.get("redirect") || "/"));

    if (enteredPassword !== configuredPassword) {
      return renderLoginPage(removeSessionExpiredParam(redirectPath), true, false);
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const token = await createToken(expiresAt, configuredPassword);
    const headers = new Headers();
    headers.set("location", removeSessionExpiredParam(redirectPath));
    appendAuthCookies(headers, token, expiresAt);
    return new Response(null, { status: 302, headers });
  }

  const validSession = await hasValidSession(request, configuredPassword);
  if (!validSession) {
    const redirectPath = sanitizeRedirect(`${url.pathname}${url.search}`);
    const showSessionExpired = url.searchParams.get(SESSION_EXPIRED_QUERY_PARAM) === "1";
    return renderLoginPage(removeSessionExpiredParam(redirectPath), false, showSessionExpired);
  }

  if (url.pathname === LOGOUT_PATH) {
    const headers = new Headers();
    headers.set("location", "/");
    appendClearAuthCookies(headers);
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname.startsWith(PREVIEW_PATH_PREFIX)) {
    return renderPdfPreviewPage(url);
  }

  if (url.pathname.startsWith(VIEW_PATH_PREFIX)) {
    return handlePdfPreview(request, env, url);
  }

  if (isBlockedFilePath(url.pathname)) {
    return new Response("Direct file downloads are disabled.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=UTF-8" }
    });
  }

  return next();
}

function sanitizeRedirect(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  const entries = cookieHeader.split(";").map((segment) => segment.trim());
  const result = {};

  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    result[key] = value;
  }

  return result;
}

async function hasValidSession(request, password) {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const rawToken = cookies[COOKIE_NAME];

  if (!rawToken) {
    return false;
  }

  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const expiresAt = Number(parts[0]);
  const signature = parts[1];

  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = await sign(String(expiresAt), password);
  return safeEqual(signature, expected);
}

async function createToken(expiresAt, password) {
  const payload = String(expiresAt);
  const signature = await sign(payload, password);
  return `${payload}.${signature}`;
}

async function sign(value, secret) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  const bytes = new Uint8Array(signatureBuffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

function renderLoginPage(redirectPath, hasError, showSessionExpired) {
  const errorMarkup = hasError
    ? "<p style=\"margin:0 0 12px;color:#b42318;font-size:14px;\">Incorrect password. Try again.</p>"
    : "";
  const sessionExpiredMarkup = showSessionExpired
    ? "<p style=\"margin:0 0 12px;color:#b42318;font-size:14px;font-weight:600;\">Session has expired. Please log back in.</p>"
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Protected site</title>
</head>
<body style="margin:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#1e2329;">
  <main style="background:#fff;border:1px solid #dcdfe6;border-radius:12px;padding:24px;width:min(92vw,400px);box-shadow:0 8px 24px rgba(16,24,40,.08);">
    <h1 style="margin:0 0 10px;font-size:22px;">Password required</h1>
    <p style="margin:0 0 16px;color:#616b76;">Enter password to access this website.</p>
    ${sessionExpiredMarkup}
    ${errorMarkup}
    <form method="post" action="${AUTH_PATH}">
      <input type="hidden" name="redirect" value="${escapeHtml(redirectPath)}" />
      <label for="password" style="display:block;margin:0 0 8px;font-size:14px;">Password</label>
      <input id="password" name="password" type="password" required autofocus style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dcdfe6;border-radius:8px;font-size:16px;" />
      <button type="submit" style="margin-top:14px;width:100%;box-sizing:border-box;padding:10px 12px;border:0;border-radius:8px;background:#165dff;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">Continue</button>
    </form>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: hasError ? 401 : 200,
    headers: { "content-type": "text/html; charset=UTF-8" }
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function clearExpiryCookieHeader() {
  return `${EXPIRY_COOKIE_NAME}=; Path=/; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function appendClearAuthCookies(headers) {
  headers.append("set-cookie", clearCookieHeader());
  headers.append("set-cookie", clearExpiryCookieHeader());
}

function appendAuthCookies(headers, token, expiresAt) {
  headers.append("set-cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
  headers.append("set-cookie", `${EXPIRY_COOKIE_NAME}=${expiresAt}; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
}

function removeSessionExpiredParam(pathWithQuery) {
  try {
    const parsed = new URL(pathWithQuery, "https://example.com");
    parsed.searchParams.delete(SESSION_EXPIRED_QUERY_PARAM);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
  } catch (_error) {
    return pathWithQuery;
  }
}

function isBlockedFilePath(pathname) {
  return /^\/files(\/|$)/i.test(String(pathname || ""));
}

async function handlePdfPreview(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const requestDestination = String(request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (["document", "iframe", "embed", "object"].includes(requestDestination)) {
    return new Response("Direct PDF navigation is disabled. Use preview mode.", { status: 403 });
  }

  const requestedPath = decodeURIComponent(url.pathname.slice(VIEW_PATH_PREFIX.length)).replace(/^\/+/, "");

  if (!requestedPath || requestedPath.includes("..") || !/\.pdf$/i.test(requestedPath)) {
    return new Response("Invalid preview target.", { status: 400 });
  }

  const assetUrl = new URL(`/files/${requestedPath}`, url.origin);
  const assetRequest = new Request(assetUrl.toString(), request);
  const assetResponse = await env.ASSETS.fetch(assetRequest);

  if (!assetResponse.ok) {
    return new Response("Preview not found.", { status: assetResponse.status === 404 ? 404 : 502 });
  }

  const headers = new Headers(assetResponse.headers);
  const fileName = requestedPath.split("/").pop() || "document.pdf";
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", `inline; filename="${fileName.replace(/\"/g, "")}"`);
  headers.set("x-content-type-options", "nosniff");

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    headers
  });
}

function renderPdfPreviewPage(url) {
  const requestedPath = decodeURIComponent(url.pathname.slice(PREVIEW_PATH_PREFIX.length)).replace(/^\/+/, "");

  if (!requestedPath || requestedPath.includes("..") || !/\.pdf$/i.test(requestedPath)) {
    return new Response("Invalid preview target.", { status: 400 });
  }

  const encodedPath = requestedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const pdfUrl = `/__view/${encodedPath}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PDF Preview</title>
  <style>
    :root { color-scheme: light; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; background:#f7f8fa; color:#1e2329; }
    .topbar { position:sticky; top:0; z-index:10; display:flex; gap:10px; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #dcdfe6; background:#fff; }
    .controls { display:flex; align-items:center; gap:8px; }
    button { border:1px solid #dcdfe6; background:#fff; color:#1e2329; border-radius:8px; padding:7px 10px; font-size:14px; cursor:pointer; }
    .zoom-btn { width:36px; height:34px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:18px; line-height:1; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    #status { font-size:14px; color:#616b76; min-width:88px; text-align:center; }
    #viewer { width:calc(100vw - 24px); max-width:none; margin:16px auto 28px; padding:0 12px; overflow-x:auto; }
    #viewerInner { min-width:100%; width:max-content; margin:0 auto; }
    .page { display:block; width:auto; max-width:none; margin:0 auto 12px; background:#fff; border:1px solid #dcdfe6; border-radius:8px; box-shadow:0 2px 10px rgba(16,24,40,.06); }
    .hint { font-size:12px; color:#616b76; }
    #zoomStatus { font-size:13px; color:#616b76; min-width:52px; text-align:center; }
    #printNotice { display:none; max-width:640px; margin:36px auto; padding:20px; border:1px solid #dcdfe6; border-radius:12px; background:#fff; text-align:center; font-size:20px; font-weight:600; color:#b42318; }

    @media print {
      .topbar, #viewer { display:none !important; }
      #printNotice { display:block !important; }
      body { background:#fff !important; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="controls">
      <button id="prev">Prev</button>
      <span id="status">Page 0 / 0</span>
      <button id="next">Next</button>
      <button id="zoomOut" class="zoom-btn">-</button>
      <span id="zoomStatus">135%</span>
      <button id="zoomIn" class="zoom-btn">+</button>
    </div>
    <div class="hint">Preview only</div>
  </div>
  <main id="viewer"><div id="viewerInner"></div></main>
  <div id="printNotice">Printing is disabled.</div>

  <script type="module">
    import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

    const pdfUrl = ${JSON.stringify(pdfUrl)};
    const viewer = document.getElementById("viewer");
    const status = document.getElementById("status");
    const prevBtn = document.getElementById("prev");
    const nextBtn = document.getElementById("next");
    const zoomInBtn = document.getElementById("zoomIn");
    const zoomOutBtn = document.getElementById("zoomOut");
    const zoomStatus = document.getElementById("zoomStatus");
    const hint = document.querySelector(".hint");
    const viewerInner = document.getElementById("viewerInner");
    const expiryCookieName = ${JSON.stringify(EXPIRY_COOKIE_NAME)};
    const expiredParam = ${JSON.stringify(SESSION_EXPIRED_QUERY_PARAM)};

    let pdfDoc = null;
    let pageNum = 1;
    let scale = 1.35;
    const MIN_SCALE = 0.6;
    const MAX_SCALE = 2.0;
    let pageCanvases = [];

    function readCookie(name) {
      const needle = name + "=";
      const entries = document.cookie ? document.cookie.split("; ") : [];
      for (const entry of entries) {
        if (entry.startsWith(needle)) {
          return decodeURIComponent(entry.slice(needle.length));
        }
      }
      return "";
    }

    function scheduleSessionExpiryReload() {
      const rawExpiry = readCookie(expiryCookieName);
      const expirySeconds = Number(rawExpiry);
      if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) {
        return;
      }

      const delayMs = expirySeconds * 1000 - Date.now();
      if (delayMs <= 0) {
        reloadForExpiredSession();
        return;
      }

      const safeDelay = Math.min(delayMs, 2147483647);
      window.setTimeout(reloadForExpiredSession, safeDelay);
    }

    function reloadForExpiredSession() {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set(expiredParam, "1");
      window.location.replace(nextUrl.toString());
    }

    function updateZoomStatus() {
      if (!zoomStatus) {
        return;
      }
      zoomStatus.textContent = Math.round(scale * 100) + "%";
    }

    function updateStatus() {
      const total = pdfDoc ? pdfDoc.numPages : 0;
      status.textContent = "Page " + pageNum + " / " + total;
      prevBtn.disabled = !pdfDoc || pageNum <= 1;
      nextBtn.disabled = !pdfDoc || pageNum >= total;
    }

    function getCurrentPageFromScroll() {
      if (!pageCanvases.length) {
        return pageNum;
      }

      const targetY = window.innerHeight * 0.35;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      pageCanvases.forEach((canvas, index) => {
        const rect = canvas.getBoundingClientRect();
        const distance = Math.abs(rect.top - targetY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      return closestIndex + 1;
    }

    function scrollToPage(targetPage) {
      const canvas = pageCanvases[targetPage - 1];
      if (!canvas) {
        return;
      }

      canvas.scrollIntoView({ behavior: "smooth", block: "start" });
      pageNum = targetPage;
      updateStatus();
    }

    function getViewerScrollRatioX() {
      const maxScroll = viewer.scrollWidth - viewer.clientWidth;
      if (maxScroll <= 0) {
        return 0;
      }
      return viewer.scrollLeft / maxScroll;
    }

    function restoreViewerScrollRatioX(ratioX) {
      const maxScroll = viewer.scrollWidth - viewer.clientWidth;
      if (maxScroll <= 0) {
        viewer.scrollLeft = 0;
        return;
      }

      const clamped = Math.max(0, Math.min(1, Number(ratioX) || 0));
      viewer.scrollLeft = Math.round(maxScroll * clamped);
    }

    async function renderDocument(options = {}) {
      const scrollRatioX = Number.isFinite(options.scrollRatioX) ? options.scrollRatioX : 0;
      if (!pdfDoc) return;
      viewerInner.innerHTML = "";
      pageCanvases = [];

      const pixelRatio = window.devicePixelRatio || 1;

      for (let index = 1; index <= pdfDoc.numPages; index += 1) {
        const page = await pdfDoc.getPage(index);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });

        canvas.className = "page";
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = Math.floor(viewport.width) + "px";
        canvas.style.height = Math.floor(viewport.height) + "px";

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        viewerInner.appendChild(canvas);
        pageCanvases.push(canvas);

        await page.render({ canvasContext: context, viewport }).promise;
      }

      if (pageNum > pdfDoc.numPages) {
        pageNum = pdfDoc.numPages;
      }

      if (pageNum < 1) {
        pageNum = 1;
      }

      const initialCanvas = pageCanvases[pageNum - 1];
      if (initialCanvas) {
        initialCanvas.scrollIntoView({ behavior: "auto", block: "start" });
      }

      restoreViewerScrollRatioX(scrollRatioX);
      updateZoomStatus();
      updateStatus();
    }

    prevBtn.addEventListener("click", async () => {
      if (!pdfDoc || pageNum <= 1) return;
      scrollToPage(pageNum - 1);
    });

    nextBtn.addEventListener("click", async () => {
      if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
      scrollToPage(pageNum + 1);
    });

    zoomInBtn.addEventListener("click", async () => {
      const anchorPage = getCurrentPageFromScroll();
      const hadHorizontalOverflow = viewer.scrollWidth > viewer.clientWidth;
      const scrollRatioX = hadHorizontalOverflow ? getViewerScrollRatioX() : 0.5;
      scale = Math.min(MAX_SCALE, scale + 0.2);
      pageNum = anchorPage;
      await renderDocument({ scrollRatioX });
    });

    zoomOutBtn.addEventListener("click", async () => {
      const anchorPage = getCurrentPageFromScroll();
      const scrollRatioX = getViewerScrollRatioX();
      scale = Math.max(MIN_SCALE, scale - 0.2);
      pageNum = anchorPage;
      await renderDocument({ scrollRatioX });
    });

    viewer.addEventListener("contextmenu", (event) => {
      if (event.target && event.target.closest("canvas, img")) {
        event.preventDefault();
      }
    });

    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(() => {
        const visiblePage = getCurrentPageFromScroll();
        if (visiblePage !== pageNum) {
          pageNum = visiblePage;
          updateStatus();
        }
        ticking = false;
      });
    }, { passive: true });

    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (hint) {
          hint.textContent = "Printing is disabled";
          setTimeout(() => {
            hint.textContent = "Preview only";
          }, 1800);
        }
      }
      if (event.key === "ArrowLeft") {
        prevBtn.click();
      }
      if (event.key === "ArrowRight") {
        nextBtn.click();
      }
    });

    window.addEventListener("beforeprint", () => {
      if (hint) {
        hint.textContent = "Printing is disabled";
      }
    });

    window.addEventListener("afterprint", () => {
      if (hint) {
        hint.textContent = "Preview only";
      }
    });

    try {
      updateZoomStatus();
      scheduleSessionExpiryReload();
      const loadingTask = pdfjsLib.getDocument({
        url: pdfUrl,
        disableAutoFetch: true,
        disableStream: false,
        withCredentials: true,
      });
      pdfDoc = await loadingTask.promise;
      updateStatus();
      await renderDocument();
    } catch (_error) {
      viewer.innerHTML = '<p style="color:#b42318;padding:16px;">Unable to load PDF preview.</p>';
      updateStatus();
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}
