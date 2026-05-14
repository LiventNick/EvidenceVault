const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const ROOT_DIR = process.cwd();
const INPUT_FILE = path.join(ROOT_DIR, "master", "master.xlsx");
const OUTPUT_DIR = path.join(ROOT_DIR, "data");
const STATIC_DIR = path.join(ROOT_DIR, "static");
const FILES_PUBLIC_PREFIX = "files";
const FILES_OUTPUT_DIR = path.join(STATIC_DIR, FILES_PUBLIC_PREFIX);
const PREVIEWS_PUBLIC_PREFIX = "previews";
const PREVIEWS_OUTPUT_DIR = path.join(STATIC_DIR, PREVIEWS_PUBLIC_PREFIX);

const copiedFileCache = new Map();
const generatedPreviewCache = new Map();

function slugifySheetName(name) {
  return String(name || "sheet")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sheet";
}

function normalizeHeader(rawValue, fallbackIndex) {
  const source = String(rawValue ?? "").trim() || `column_${fallbackIndex + 1}`;
  return source
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `column_${fallbackIndex + 1}`;
}

function getCellDisplayValue(cell) {
  if (!cell) {
    return "";
  }

  if (cell.w !== undefined && cell.w !== null) {
    return cell.w;
  }

  if (cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10);
  }

  return cell.v ?? "";
}

function normalizeUrl(url) {
  return String(url || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function isExternalUrl(url) {
  return /^(https?:\/\/|mailto:|tel:|#)/i.test(url);
}

function isWorkbookInternalTarget(url) {
  return /^#/.test(String(url || ""));
}

function parseWorkbookInternalSheetName(target) {
  const value = String(target || "").replace(/^#/, "");
  const exclamationIndex = value.indexOf("!");
  const reference = exclamationIndex === -1 ? value : value.slice(0, exclamationIndex);
  const unquoted = reference.trim().replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
  return unquoted;
}

function stripUrlDecorators(url) {
  return String(url || "").split("#")[0].split("?")[0];
}

function decodeUrlPath(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function resolveInputFilePath(relativeUrl) {
  const cleanRelativeUrl = decodeUrlPath(
    stripUrlDecorators(relativeUrl)
  )
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .replace(new RegExp(`^${FILES_PUBLIC_PREFIX}/`, "i"), "");
  
  // First try to resolve in master folder
  const masterPath = path.resolve(ROOT_DIR, "master", cleanRelativeUrl);
  if (masterPath.startsWith(path.resolve(ROOT_DIR, "master")) && fs.existsSync(masterPath)) {
    return masterPath;
  }
  
  // Fall back to root directory
  const resolvedPath = path.resolve(ROOT_DIR, cleanRelativeUrl);
  if (!resolvedPath.startsWith(ROOT_DIR)) {
    return null;
  }

  return resolvedPath;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function encodePathSegments(pathValue) {
  return toPosixPath(pathValue)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function clearDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry);
    const stat = fs.statSync(entryPath);

    if (stat.isDirectory()) {
      clearDirectory(entryPath);
      fs.rmdirSync(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }
}

function copyLinkedFile(localUrl) {
  const normalizedLocalUrl = decodeUrlPath(normalizeUrl(localUrl))
    .replace(/^\/+/, "")
    .replace(new RegExp(`^${FILES_PUBLIC_PREFIX}/`, "i"), "");

  if (copiedFileCache.has(normalizedLocalUrl)) {
    return copiedFileCache.get(normalizedLocalUrl);
  }

  const sourcePath = resolveInputFilePath(normalizedLocalUrl);

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    console.warn(`Missing linked file: ${normalizedLocalUrl}`);
    return normalizedLocalUrl;
  }

  const destinationPath = path.join(FILES_OUTPUT_DIR, normalizedLocalUrl);
  const destinationDir = path.dirname(destinationPath);

  ensureDirectory(destinationDir);
  fs.copyFileSync(sourcePath, destinationPath);

  const publicPath = `${FILES_PUBLIC_PREFIX}/${normalizedLocalUrl}`;
  copiedFileCache.set(normalizedLocalUrl, publicPath);
  return publicPath;
}

function normalizeHexColor(value) {
  if (!value) {
    return null;
  }

  const cleaned = String(value).replace(/^#/, "").trim();
  if (cleaned.length === 8) {
    return `#${cleaned.slice(2)}`.toLowerCase();
  }
  if (cleaned.length === 6) {
    return `#${cleaned}`.toLowerCase();
  }
  return null;
}

function isCellRenderedAsRed(cell) {
  if (!cell) {
    return false;
  }

  const fontColor =
    cell.s &&
    cell.s.font &&
    cell.s.font.color &&
    (cell.s.font.color.rgb || cell.s.font.color.RGB);

  const normalizedFontColor = normalizeHexColor(fontColor);
  if (normalizedFontColor === "#ff0000") {
    return true;
  }

  const hasRedNumberFormat = typeof cell.z === "string" && /\[red\]/i.test(cell.z);
  if (!hasRedNumberFormat) {
    return false;
  }

  if (typeof cell.v === "number") {
    return cell.v < 0;
  }

  return true;
}

function applySheetVisualStylesToHtml(sheet, sheetHtml) {
  let resultHtml = sheetHtml;
  const cellAddresses = Object.keys(sheet).filter((key) => /^[A-Z]+\d+$/.test(key));

  cellAddresses.forEach((address) => {
    const cell = sheet[address];
    if (!isCellRenderedAsRed(cell)) {
      return;
    }

    const htmlIdToken = `id="sjs-${address}"`;
    if (!resultHtml.includes(htmlIdToken)) {
      return;
    }

    resultHtml = resultHtml.replace(htmlIdToken, `${htmlIdToken} style="color:#c00000;font-weight:600;"`);
  });

  return resultHtml;
}

function applySheetHyperlinksToHtml(sheet, sheetHtml, sheetSlugMap) {
  let resultHtml = sheetHtml;
  const cellAddresses = Object.keys(sheet).filter((key) => /^[A-Z]+\d+$/.test(key));

  cellAddresses.forEach((address) => {
    const cell = sheet[address];
    if (!cell || !cell.l) {
      return;
    }

    const originalTarget = cell.l.Target || cell.l.target;
    if (!originalTarget) {
      return;
    }

    const normalizedTarget = String(originalTarget);
    const href = isWorkbookInternalTarget(normalizedTarget)
      ? `./${normalizedTarget}`
      : normalizedTarget;
    const linkText = escapeHtml(String(getCellDisplayValue(cell) || "View"));
    const tdPattern = new RegExp(`(<td\\b[^>]*id=\"sjs-${address}\"[^>]*>)([\\s\\S]*?)(</td>)`);

    resultHtml = resultHtml.replace(tdPattern, (fullMatch, startTag, cellContent, endTag) => {
      if (/<a\b/i.test(cellContent)) {
        return fullMatch;
      }

      return `${startTag}<a href="${escapeHtml(href)}">${linkText}</a>${endTag}`;
    });
  });

  return resultHtml;
}

function buildWorkbookPreviewHtml(previewTitle, workbook, _originalFilePublicPath, _previewPublicPath) {
  const sheetsHtml = workbook.SheetNames.map((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const tableHtml = buildSheetHtml(sheet);
    const activeClass = index === 0 ? " active" : "";
    return `<section id="sheet-${index}" class="sheet${activeClass}"><h2>${escapeHtml(sheetName)}</h2><div class="table-wrap">${tableHtml}</div></section>`;
  }).join("\n");

  const navHtml = workbook.SheetNames.map((sheetName, index) => {
    const activeClass = index === 0 ? " active" : "";
    return `<a href="#sheet-${index}" class="tab${activeClass}" data-target="sheet-${index}">${escapeHtml(sheetName)}</a>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(previewTitle)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #f7f8fa; color: #1e2329; }
    main { max-width: 1400px; margin: 0 auto; padding: 24px 16px 40px; }
    .topbar { margin-bottom: 14px; }
    .title { margin: 0; font-size: 1.2rem; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; border-bottom: 1px solid #dcdfe6; padding-bottom: 8px; }
    .tab { text-decoration: none; color: #1e2329; border: 1px solid #dcdfe6; border-radius: 8px; padding: 7px 10px; font-size: 0.9rem; font-weight: 600; background: #fff; }
    .tab.active { background: #165dff; border-color: #165dff; color: #fff; }
    .sheet { display: none; border: 1px solid #dcdfe6; border-radius: 12px; background: #fff; overflow: hidden; }
    .sheet.active { display: block; }
    .sheet h2 { margin: 0; padding: 12px 14px; font-size: 1.05rem; border-bottom: 1px solid #dcdfe6; background: #fbfcff; }
    .table-wrap { overflow: auto; padding: 10px; }
    .excel-sheet-table { width: 100%; border-collapse: collapse; table-layout: auto; }
    .excel-sheet-table td, .excel-sheet-table th { min-height: 32px; height: auto; border: 1px solid #d0d7de; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
    #printNotice { display: none; max-width: 640px; margin: 36px auto; padding: 20px; border: 1px solid #dcdfe6; border-radius: 12px; background: #fff; text-align: center; font-size: 20px; font-weight: 600; color: #b42318; }
    @media print {
      main { display: none !important; }
      #printNotice { display: block !important; }
      body { background: #fff !important; }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1 class="title">${escapeHtml(previewTitle)}</h1>
    </div>
    <nav class="tabs">${navHtml}</nav>
    ${sheetsHtml}
  </main>
  <div id="printNotice">Printing is disabled.</div>
  <script>
    (function () {
      const expiryCookieName = "lc_auth_exp";
      const expiredParam = "sessionExpired";
      const tabs = Array.from(document.querySelectorAll(".tab"));
      const sheets = Array.from(document.querySelectorAll(".sheet"));

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

      function reloadForExpiredSession() {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set(expiredParam, "1");
        window.location.replace(nextUrl.toString());
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

        window.setTimeout(reloadForExpiredSession, Math.min(delayMs, 2147483647));
      }
      function activate(id) {
        tabs.forEach((tab) => tab.classList.toggle("active", tab.getAttribute("data-target") === id));
        sheets.forEach((sheet) => sheet.classList.toggle("active", sheet.id === id));
      }
      tabs.forEach((tab) => {
        tab.addEventListener("click", function (event) {
          event.preventDefault();
          const id = tab.getAttribute("data-target");
          if (!id) return;
          history.replaceState(null, "", "#" + id);
          activate(id);
        });
      });
      if (location.hash) {
        const target = location.hash.slice(1);
        if (target) activate(target);
      }

      window.addEventListener("keydown", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
          event.preventDefault();
        }
      });

      scheduleSessionExpiryReload();
    })();
  </script>
</body>
</html>`;
}

function createTabularPreviewForLinkedFile(originalLocalPath, originalFilePublicPath, downloadLabel) {
  if (generatedPreviewCache.has(originalLocalPath)) {
    return generatedPreviewCache.get(originalLocalPath);
  }

  const previewPublicPath = `${PREVIEWS_PUBLIC_PREFIX}/${originalLocalPath}.html`;
  const previewOutputPath = path.join(STATIC_DIR, previewPublicPath);
  ensureDirectory(path.dirname(previewOutputPath));

  const originalSourcePath = resolveInputFilePath(originalLocalPath);
  if (!originalSourcePath || !fs.existsSync(originalSourcePath)) {
    generatedPreviewCache.set(originalLocalPath, originalFilePublicPath);
    return originalFilePublicPath;
  }

  const linkedWorkbook = XLSX.readFile(originalSourcePath, {
    cellDates: true,
    raw: false,
    cellStyles: true,
  });

  const html = buildWorkbookPreviewHtml(path.basename(originalLocalPath), linkedWorkbook, originalFilePublicPath, toPosixPath(previewPublicPath)).replace(
    "Download original .xlsx",
    downloadLabel
  );
  fs.writeFileSync(previewOutputPath, html, "utf8");

  const previewUrl = `./${encodePathSegments(previewPublicPath)}`;
  generatedPreviewCache.set(originalLocalPath, previewUrl);
  return previewUrl;
}

function createXlsxPreviewForLinkedFile(originalLocalPath, originalFilePublicPath) {
  return createTabularPreviewForLinkedFile(originalLocalPath, originalFilePublicPath, "Download original .xlsx");
}

function createCsvPreviewForLinkedFile(originalLocalPath, originalFilePublicPath) {
  return createTabularPreviewForLinkedFile(originalLocalPath, originalFilePublicPath, "Download original .csv");
}

function normalizeCellUrlForSite(rawUrl, sheetSlugMap) {
  const normalized = normalizeUrl(rawUrl);

  if (/^(\.\/)?__(preview|view)\//i.test(normalized)) {
    return normalized.startsWith("./") ? normalized : `./${normalized}`;
  }

  if (isWorkbookInternalTarget(normalized)) {
    const targetSheet = parseWorkbookInternalSheetName(normalized);
    const targetSlug = sheetSlugMap.get(targetSheet);
    if (targetSlug) {
      return `#${targetSlug}`;
    }
    return normalized;
  }

  if (isExternalUrl(normalized)) {
    return normalized;
  }

  const copiedPublicPath = copyLinkedFile(normalized);
  const decodedLocalPath = decodeUrlPath(normalizeUrl(normalized))
    .replace(/^\/+/, "")
    .replace(new RegExp(`^${FILES_PUBLIC_PREFIX}/`, "i"), "");

  if (/\.xlsx$/i.test(decodedLocalPath)) {
    return createXlsxPreviewForLinkedFile(decodedLocalPath, `./${encodePathSegments(copiedPublicPath)}`);
  }

  if (/\.csv$/i.test(decodedLocalPath)) {
    return createCsvPreviewForLinkedFile(decodedLocalPath, `./${encodePathSegments(copiedPublicPath)}`);
  }

  if (/\.pdf$/i.test(decodedLocalPath)) {
    return `./__preview/${encodePathSegments(decodedLocalPath)}`;
  }

  return `./${encodePathSegments(copiedPublicPath)}`;
}

function parseCellValue(cell, sheetSlugMap) {
  if (!cell) {
    return "";
  }

  const hyperlink = cell.l && (cell.l.Target || cell.l.target);
  if (hyperlink) {
    const text = String(getCellDisplayValue(cell) || "View");
    const url = normalizeCellUrlForSite(hyperlink, sheetSlugMap);

    return {
      text,
      url,
    };
  }

  return getCellDisplayValue(cell);
}

function ensureUniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header) => {
    const current = counts.get(header) || 0;
    counts.set(header, current + 1);

    if (current === 0) {
      return header;
    }

    return `${header}_${current + 1}`;
  });
}

function isMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "object") {
    return Boolean(value.url || value.text);
  }

  return true;
}

function isMeaningfulCell(cell) {
  if (!cell) {
    return false;
  }

  if (cell.l && (cell.l.Target || cell.l.target)) {
    return true;
  }

  if (cell.f) {
    return true;
  }

  if (cell.v === null || cell.v === undefined) {
    return false;
  }

  if (typeof cell.v === "string") {
    return cell.v.trim().length > 0;
  }

  return true;
}

function getTrimmedSheetRef(sheet) {
  if (!sheet["!ref"]) {
    return "A1";
  }

  const originalRange = XLSX.utils.decode_range(sheet["!ref"]);
  let maxRow = originalRange.s.r;
  let maxCol = originalRange.s.c;
  let found = false;

  for (let row = originalRange.s.r; row <= originalRange.e.r; row += 1) {
    for (let col = originalRange.s.c; col <= originalRange.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];

      if (!isMeaningfulCell(cell)) {
        continue;
      }

      found = true;
      if (row > maxRow) {
        maxRow = row;
      }
      if (col > maxCol) {
        maxCol = col;
      }
    }
  }

  if (!found) {
    return XLSX.utils.encode_range({
      s: { r: originalRange.s.r, c: originalRange.s.c },
      e: { r: originalRange.s.r, c: originalRange.s.c },
    });
  }

  return XLSX.utils.encode_range({
    s: { r: originalRange.s.r, c: originalRange.s.c },
    e: { r: maxRow, c: maxCol },
  });
}

function convertSheet(sheet, sheetSlugMap) {
  if (!sheet["!ref"]) {
    return [];
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const headerRowIndex = range.s.r;

  const rawHeaders = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const address = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
    const cell = sheet[address];
    const header = normalizeHeader(getCellDisplayValue(cell), col - range.s.c);
    rawHeaders.push(header);
  }

  const headers = ensureUniqueHeaders(rawHeaders);
  const rows = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row = {};
    let rowHasData = false;

    headers.forEach((header, index) => {
      const col = range.s.c + index;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: col });
      const cell = sheet[address];
      const value = parseCellValue(cell, sheetSlugMap);

      row[header] = value;

      if (isMeaningfulValue(value)) {
        rowHasData = true;
      }
    });

    if (rowHasData) {
      rows.push(row);
    }
  }

  return rows;
}

function prepareSheetHyperlinksForHtml(sheet, sheetSlugMap) {
  if (!sheet["!ref"]) {
    return;
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];

      if (!cell || !cell.l) {
        continue;
      }

      const originalTarget = cell.l.Target || cell.l.target;
      if (!originalTarget) {
        continue;
      }

      const normalized = normalizeCellUrlForSite(originalTarget, sheetSlugMap);
      if (isExternalUrl(normalized)) {
        cell.l.Target = normalized;
      } else if (isWorkbookInternalTarget(normalized)) {
        cell.l.Target = `./${normalized}`;
      } else {
        cell.l.Target = normalized;
      }
    }
  }
}

function postProcessSheetHtml(sheetHtml) {
  return String(sheetHtml)
    .replace(/<a\s+/gi, '<a target="_blank" rel="noopener noreferrer" ')
    .replace(/<table/gi, '<table class="excel-sheet-table"')
    .replace(/\r\n|\r/g, "\n");
}

function buildSheetHtml(sheet, sheetSlugMap = new Map()) {
  const trimmedRef = getTrimmedSheetRef(sheet);
  const htmlSheet = {
    ...sheet,
    "!ref": trimmedRef,
  };

  const htmlWithLinks = applySheetHyperlinksToHtml(
    htmlSheet,
    XLSX.utils.sheet_to_html(htmlSheet),
    sheetSlugMap
  );
  const baseHtml = postProcessSheetHtml(htmlWithLinks);
  return applySheetVisualStylesToHtml(htmlSheet, baseHtml);
}

function clearOldJsonFiles(outputDir) {
  if (!fs.existsSync(outputDir)) {
    return;
  }

  fs.readdirSync(outputDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
    .forEach((fileName) => {
      fs.unlinkSync(path.join(outputDir, fileName));
    });
}

function run() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  ensureDirectory(STATIC_DIR);
  ensureDirectory(FILES_OUTPUT_DIR);
  ensureDirectory(PREVIEWS_OUTPUT_DIR);
  clearOldJsonFiles(OUTPUT_DIR);
  clearDirectory(FILES_OUTPUT_DIR);
  clearDirectory(PREVIEWS_OUTPUT_DIR);
  copiedFileCache.clear();
  generatedPreviewCache.clear();

  const workbook = XLSX.readFile(INPUT_FILE, {
    cellDates: true,
    raw: false,
    cellStyles: true,
  });

  const sheetSlugMap = new Map();
  workbook.SheetNames.forEach((sheetName) => {
    sheetSlugMap.set(sheetName, slugifySheetName(sheetName));
  });

  const sheetsSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = convertSheet(sheet, sheetSlugMap);
    const slug = slugifySheetName(sheetName);
    const fileName = `${slug}.json`;
    const outputPath = path.join(OUTPUT_DIR, fileName);

    prepareSheetHyperlinksForHtml(sheet, sheetSlugMap);
    const htmlTable = buildSheetHtml(sheet, sheetSlugMap);

    sheetsSummary.push({
      name: sheetName,
      slug,
      rows,
      html: htmlTable,
    });

    fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outputPath}`);
  });

  const summaryOutputPath = path.join(OUTPUT_DIR, "sheets.json");
  fs.writeFileSync(summaryOutputPath, `${JSON.stringify(sheetsSummary, null, 2)}\n`, "utf8");
  console.log(`Wrote ${summaryOutputPath}`);
}

run();