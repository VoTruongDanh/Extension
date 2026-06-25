const { exec } = require('child_process');
const zlib = require('zlib');
const shutdownTools = require('./tools/shutdown');
const idmTools      = require('./tools/idm-reset');
const anydeskTools  = require('./tools/anydesk-reset');
const networkTools  = require('./tools/network');
const hardwareTools = require('./tools/hardware');
const copyPasteSync = require('./tools/copy-paste-sync');
const killPortTools = require('./tools/kill-port');
const syncToken = require('./syncToken');

const SERVICE_CONFIGS = {
  router: {
    key: 'router',
    label: '9Router',
    cmd: '9router',
    args: [],
    statusCh: 'router-status',
    logCh: 'router-log'
  },
  openclaw: {
    key: 'openclaw',
    label: 'OpenClaw',
    cmd: 'openclaw',
    args: ['gateway'],
    statusCh: 'openclaw-status',
    logCh: 'openclaw-log'
  }
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeBoolean(value) {
  return ['1', 'true', 'yes', 'y'].includes(normalizeText(value).toLowerCase());
}

function normalizeSyncUrl(value) {
  const url = normalizeText(value);
  if (!url) throw new Error('Sync link khong duoc de trong');

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_) {
    throw new Error('Sync link khong hop le');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Chi ho tro sync link http hoac https');
  }

  if (parsedUrl.hostname === 'docs.google.com') {
    const match = parsedUrl.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      throw new Error('Link Google Sheet khong hop le');
    }

    const gid = parsedUrl.searchParams.get('gid') || '0';
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
  }

  return parsedUrl.toString();
}

function sanitizePreviewText(value, fallback = '') {
  return String(value || fallback || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]) : '';
}

function extractFaviconHref(html) {
  const tags = String(html || '').match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const relMatch = tag.match(/\brel\s*=\s*["']?([^"' >]+(?:\s+[^"' >]+)*)["']?/i);
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || tag.match(/\bhref\s*=\s*([^"' >]+)/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : '';
    const href = hrefMatch ? hrefMatch[1] : '';
    if (href && rel.includes('icon')) return href;
  }
  return '';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is unavailable');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'ServiceManager/1.0 LinkPreview',
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFaviconDataUrl(iconUrl) {
  try {
    const response = await fetchWithTimeout(iconUrl, {
      headers: { accept: 'image/*,*/*;q=0.8' }
    }, 3500);

    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > 65536) return iconUrl;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 65536) return iconUrl;

    const contentType = (response.headers.get('content-type') || 'image/x-icon').split(';')[0];
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (_) {
    return iconUrl;
  }
}

async function fetchLinkPreview(url, name) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_) {
    return null;
  }

  const fallback = {
    title: sanitizePreviewText(name, parsedUrl.hostname),
    favicon: null,
    thumbnail: null,
    hostname: parsedUrl.hostname,
    fetchedAt: Date.now()
  };

  const linkPreviewApiKey = normalizeText(process.env.LINKPREVIEW_API_KEY);

  if (linkPreviewApiKey) {
    try {
      const endpoint = new URL('https://api.linkpreview.net/');
      endpoint.searchParams.set('key', linkPreviewApiKey);
      endpoint.searchParams.set('q', url);

      const response = await fetchWithTimeout(endpoint.toString(), {
        headers: { accept: 'application/json' }
      }, 6000);

      if (response.ok) {
        const data = await response.json();
        const title = sanitizePreviewText(data?.title, fallback.title);
        const image = normalizeText(data?.image);
        const finalUrl = normalizeText(data?.url) || url;
        const finalParsed = new URL(finalUrl);

        let favicon = normalizeText(data?.favicon);
        if (!favicon) {
          try {
            favicon = new URL('/favicon.ico', finalUrl).toString();
          } catch (_) {}
        }

        return {
          title,
          favicon: favicon || null,
          thumbnail: image || null,
          hostname: sanitizePreviewText(finalParsed.hostname, fallback.hostname),
          fetchedAt: Date.now()
        };
      }
    } catch (_) {}
  }

  try {
    const response = await fetchWithTimeout(url, {
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }
    });

    if (!response.ok) return fallback;

    const finalUrl = response.url || url;
    const finalParsed = new URL(finalUrl);
    const html = await response.text();
    const title = sanitizePreviewText(extractTitle(html), fallback.title || finalParsed.hostname);
    const iconHref = extractFaviconHref(html);
    const iconUrl = new URL(iconHref || '/favicon.ico', finalUrl).toString();
    const favicon = await fetchFaviconDataUrl(iconUrl);

    return {
      title,
      favicon,
      thumbnail: null,
      hostname: finalParsed.hostname,
      fetchedAt: Date.now()
    };
  } catch (_) {
    return fallback;
  }
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const input = String(text || '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      pushField();
      continue;
    }

    if (char === '\n') {
      pushRow();
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    pushRow();
  }

  return rows;
}

function parseLinkCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];

  const headers = rows[0].map((value) =>
    normalizeText(String(value || '').replace(/^\uFEFF/, '')).toLowerCase()
  );

  const columnIndex = {
    name: headers.indexOf('name'),
    url: headers.indexOf('url'),
    pinned: headers.indexOf('pinned'),
    read: headers.indexOf('read')
  };

  if (columnIndex.name === -1 || columnIndex.url === -1) {
    throw new Error('Sheet phai co cot name va url o dong tieu de');
  }

  return rows.slice(1).map((cols, rowIndex) => ({
    rowNumber: rowIndex + 2,
    name: cols[columnIndex.name] || '',
    url: cols[columnIndex.url] || '',
    pinned: columnIndex.pinned === -1 ? '' : cols[columnIndex.pinned] || '',
    read: columnIndex.read === -1 ? '' : cols[columnIndex.read] || ''
  })).filter((item) => {
    const hasName = normalizeText(item.name);
    const hasUrl = normalizeText(item.url);

    if (!hasName && !hasUrl) return false;
    if (!hasName || !hasUrl) {
      throw new Error(`Dong ${item.rowNumber} phai co day du cot name va url`);
    }

    return true;
  });
}

function getUrlKey(value) {
  const raw = normalizeText(typeof value === 'string' ? value : value?.url);
  if (!raw) return '';

  try {
    return new URL(raw).toString();
  } catch (_) {
    return raw;
  }
}

function mergeLinksByUrl(currentLinks = [], importedLinks = []) {
  const merged = [];
  const seen = new Set();
  let duplicateCount = 0;

  currentLinks.forEach((item) => {
    const key = getUrlKey(item);
    if (key && seen.has(key)) {
      duplicateCount += 1;
      return;
    }

    if (key) seen.add(key);
    merged.push(item);
  });

  const newItems = [];
  importedLinks.forEach((item) => {
    const key = getUrlKey(item);
    if (key && seen.has(key)) {
      duplicateCount += 1;
      return;
    }

    if (key) seen.add(key);
    newItems.push(item);
  });

  return {
    links: [...newItems, ...merged],
    addedCount: newItems.length,
    duplicateCount
  };
}

async function syncLinksFromCsv(settings) {
  const syncUrl = normalizeText(settings.sync_url);
  const current = Array.isArray(settings.links) ? [...settings.links] : [];

  if (!syncUrl) {
    return {
      ok: true,
      skipped: true,
      sync_url: '',
      links: current,
      importedCount: 0,
      addedCount: 0,
      duplicateCount: 0
    };
  }

  const response = await fetchWithTimeout(syncUrl, {
    headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' }
  }, 8000);

  if (!response.ok) {
    throw new Error(`Khong the tai CSV (${response.status})`);
  }

  const csvText = await response.text();
  const rows = parseLinkCsv(csvText);
  const now = Date.now();
  const importedLinks = rows.map((row, index) => {
    try {
      const parsedUrl = new URL(normalizeText(row.url));
      return normalizeLink({
        name: row.name,
        url: parsedUrl.toString(),
        pinned: normalizeBoolean(row.pinned),
        read: normalizeBoolean(row.read),
        preview: {
          title: row.name,
          favicon: null,
          hostname: parsedUrl.hostname,
          fetchedAt: now
        }
      }, now + index);
    } catch (error) {
      throw new Error(`Dong ${row.rowNumber}: ${error.message}`);
    }
  });

  const merged = mergeLinksByUrl(current, importedLinks);
  settings.links = merged.links;
  persistSettings(settings);

  return {
    ok: true,
    skipped: false,
    sync_url: syncUrl,
    links: merged.links,
    importedCount: importedLinks.length,
    addedCount: merged.addedCount,
    duplicateCount: merged.duplicateCount
  };
}

function normalizePrompt(input = {}, now = Date.now()) {
  const name = normalizeText(input.name);
  const content = String(input.content || '').trim();
  if (!name) throw new Error('Tên prompt không được để trống');
  if (!content) throw new Error('Nội dung prompt không được để trống');

  return {
    id: input.id || `prompt_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    content,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function detectLinkCategory(urlText = '') {
  const url = normalizeText(urlText).toLowerCase();

  if (/docs\.google\.com\/spreadsheets|sheets|excel|\.xlsx?|\.csv/.test(url)) return 'sheet';
  if (/github\.com|gitlab\.com|bitbucket\.org|vercel\.com|netlify\.app/.test(url)) return 'tool';
  if (/youtube\.com|youtu\.be|facebook\.com|tiktok\.com|instagram\.com|x\.com|twitter\.com/.test(url)) return 'social';
  if (/notion\.so|confluence|wiki|docs\./.test(url)) return 'study';
  if (/trello\.com|jira|asana|slack\.com/.test(url)) return 'work';

  return 'auto';
}

function normalizeCategory(value, fallback = 'auto') {
  const allowed = new Set(['auto', 'work', 'study', 'tool', 'sheet', 'social', 'other']);
  const normalized = normalizeText(value).toLowerCase();
  if (allowed.has(normalized)) return normalized;
  return allowed.has(fallback) ? fallback : 'auto';
}

function normalizeLink(input = {}, now = Date.now()) {
  const name = normalizeText(input.name);
  const url = normalizeText(input.url);
  if (!name) throw new Error('Tên link không được để trống');
  if (!url) throw new Error('Link không được để trống');

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error('Link không hợp lệ');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Chỉ hỗ trợ link http hoặc https');
  }

  const autoCategory = detectLinkCategory(parsedUrl.toString());
  const category = normalizeCategory(input.category, autoCategory);

  const preview = input.preview && typeof input.preview === 'object'
    ? {
        title: sanitizePreviewText(input.preview.title, name || parsedUrl.hostname),
        favicon: normalizeText(input.preview.favicon) || null,
        thumbnail: normalizeText(input.preview.thumbnail) || null,
        hostname: sanitizePreviewText(input.preview.hostname, parsedUrl.hostname),
        fetchedAt: input.preview.fetchedAt || now
      }
    : {
        title: name,
        favicon: null,
        thumbnail: null,
        hostname: parsedUrl.hostname,
        fetchedAt: now
      };

  return {
    id: input.id || `link_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    url: parsedUrl.toString(),
    read: !!input.read,
    pinned: !!input.pinned,
    category,
    preview,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function persistSettings(settings) {
  settings._save();
}

function sanitizeSettingsForSync(settings) {
  return {
    autoLaunch: !!settings.autoLaunch,
    autoHeal: !!settings.autoHeal,
    autoStartRouter: !!settings.autoStartRouter,
    autoStartOpenclaw: !!settings.autoStartOpenclaw,
    minimizeToTray: settings.minimizeToTray !== false,
    startMinimized: !!settings.startMinimized,
    prompts: Array.isArray(settings.prompts) ? settings.prompts : [],
    links: Array.isArray(settings.links) ? settings.links : [],
    sync_url: normalizeText(settings.sync_url)
  };
}

function register({ ipcMain, app, shell, settings, services, tray, getWindow }) {
  const send = (channel, data) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };

  const broadcastStatus = async () => {
    const data = await services.getStatus();
    send('status-update', data);
    tray.updateMenu({ routerRunning: data.router.running, openclawRunning: data.openclaw.running });
    return data;
  };

  Object.values(SERVICE_CONFIGS).forEach((cfg) => {
    services.registerService(cfg, {
      onStatus: (data) => {
        send(cfg.statusCh, data);
        broadcastStatus();
      },
      onLog: (data) => send(cfg.logCh, data),
      onCrash: (label, code) => tray.notify(`${label} da crash`, `Process thoat voi code ${code}`),
      onAutoHeal: (label, reason, attempt) =>
        tray.notify('Auto-heal', `${label}: ${reason} (${attempt}/3)`)
    });
  });

  services.setAutoHealEnabled(!!settings.autoHeal);

  ipcMain.on('check-status', async (event) => {
    const data = await broadcastStatus();
    event.reply('status-update', data);
  });

  ipcMain.on('get-settings', async (event) => {
    const autoLaunch = await checkAutoLaunch();
    event.reply('settings-data', {
      autoLaunch,
      autoHeal: settings.autoHeal !== false,
      startMinimized: settings.startMinimized,
      autoStartRouter: settings.autoStartRouter,
      autoStartOpenclaw: settings.autoStartOpenclaw,
      minimizeToTray: settings.minimizeToTray,
      sync_token: normalizeText(settings.sync_token),
      sync_meta: settings.sync_meta || null,
      _path: settings._settingsPath || ''
    });
  });

  ipcMain.on('save-settings', (event, newSettings) => {
    const wasAutoLaunch = settings.autoLaunch;
    const keys = ['autoLaunch', 'autoHeal', 'startMinimized', 'autoStartRouter', 'autoStartOpenclaw', 'minimizeToTray', 'sync_token'];

    keys.forEach((key) => {
      if (newSettings[key] !== undefined) settings[key] = newSettings[key];
    });

    settings._save();

    if (newSettings.autoLaunch !== undefined && newSettings.autoLaunch !== wasAutoLaunch) {
      setAutoLaunch(newSettings.autoLaunch);
    }

    if (newSettings.autoHeal !== undefined) {
      services.setAutoHealEnabled(newSettings.autoHeal);
    }

    event.reply('settings-saved');
  });

  ipcMain.on('set-auto-heal', (event, enabled) => {
    settings.autoHeal = !!enabled;
    settings._save();
    services.setAutoHealEnabled(settings.autoHeal);
    event.reply('auto-heal-saved', { enabled: settings.autoHeal });
  });

  ipcMain.on('get-app-version', (event) => event.reply('app-version', app.getVersion()));

  ipcMain.on('open-browser', (_, url) => shell.openExternal(url));
  ipcMain.on('open-folder', (_, folderPath) => exec(`explorer "${folderPath}"`, () => {}));

  ipcMain.handle('library-get-all', () => ({
    prompts: Array.isArray(settings.prompts) ? settings.prompts : [],
    links: Array.isArray(settings.links) ? settings.links : [],
    sync_url: normalizeText(settings.sync_url)
  }));

  ipcMain.handle('link-sync-save', (_, syncUrl) => {
    settings.sync_url = normalizeSyncUrl(syncUrl);
    persistSettings(settings);
    return { ok: true, sync_url: settings.sync_url };
  });

  ipcMain.handle('link-sync-now', async () => {
    return await syncLinksFromCsv(settings);
  });

  ipcMain.handle('token-sync-upload', async () => {
    const tokenRaw = normalizeText(settings.sync_token);
    if (!tokenRaw) throw new Error('Bạn chưa nhập sync token');

    const parsed = syncToken.parseUploadthingToken(tokenRaw);
    if (!parsed.apiKey) throw new Error('Token không chứa apiKey hợp lệ');

    const payload = sanitizeSettingsForSync(settings);
    const hash = syncToken.hashObject(payload);

    if (settings.sync_meta && settings.sync_meta.hash === hash) {
      return { ok: true, skipped: true, reason: 'unchanged', sync_meta: settings.sync_meta };
    }

    const fileBuffer = syncToken.encodeSettingsBlob(payload);
    const fileName = syncToken.buildSyncFileName(parsed.appId || 'app');
    const presign = await syncToken.createUploadthingPresign({
      apiKey: parsed.apiKey,
      fileName,
      fileBuffer,
      metadata: {
        appId: parsed.appId || '',
        kind: 'settings-sync',
        hash
      }
    });

    await syncToken.uploadToPresignedUrl(presign.url, fileName, fileBuffer);

    settings.sync_meta = {
      fileKey: presign.key || '',
      hash,
      appId: parsed.appId || '',
      regions: parsed.regions || [],
      uploadedAt: Date.now()
    };
    persistSettings(settings);

    return { ok: true, skipped: false, sync_meta: settings.sync_meta };
  });

  ipcMain.handle('token-sync-download', async () => {
    const tokenRaw = normalizeText(settings.sync_token);
    if (!tokenRaw) throw new Error('Bạn chưa nhập sync token');
    if (!settings.sync_meta || !settings.sync_meta.fileKey) {
      throw new Error('Chưa có metadata sync để tải xuống');
    }

    const parsed = syncToken.parseUploadthingToken(tokenRaw);
    if (!parsed.apiKey) throw new Error('Token không chứa apiKey hợp lệ');

    const fileUrl = await syncToken.getFileUrlByKey({
      apiKey: parsed.apiKey,
      fileKey: settings.sync_meta.fileKey
    });

    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Tải file sync thất bại (${response.status})`);

    const compressed = Buffer.from(await response.arrayBuffer());
    const raw = zlib.gunzipSync(compressed).toString('utf8');
    const data = JSON.parse(raw);

    const incomingHash = syncToken.hashObject(data);
    if (settings.sync_meta.hash && incomingHash !== settings.sync_meta.hash) {
      throw new Error('Hash không khớp, dữ liệu sync có thể bị lỗi');
    }

    const keys = ['autoLaunch', 'autoHeal', 'startMinimized', 'autoStartRouter', 'autoStartOpenclaw', 'minimizeToTray', 'prompts', 'links', 'sync_url'];
    keys.forEach((key) => {
      if (data[key] !== undefined) settings[key] = data[key];
    });

    persistSettings(settings);

    return { ok: true, applied: true, sync_meta: settings.sync_meta };
  });

  ipcMain.handle('link-export', async () => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Xuất danh sách link',
      defaultPath: `manager-links-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!filePath) return { cancelled: true };

    const fs = require('fs');
    fs.writeFileSync(filePath, JSON.stringify(settings.links, null, 2), 'utf-8');
    return { ok: true, path: filePath };
  });

  ipcMain.handle('link-import', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Nhập danh sách link',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (!filePaths || filePaths.length === 0) return { cancelled: true };

    const fs = require('fs');
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    const importedLinks = JSON.parse(content);

    if (!Array.isArray(importedLinks)) {
      throw new Error('Định dạng file không hợp lệ (phải là một mảng link)');
    }

    const current = Array.isArray(settings.links) ? [...settings.links] : [];
    const merged = mergeLinksByUrl(current, importedLinks);
    
    settings.links = merged.links;
    persistSettings(settings);

    return { 
      ok: true, 
      importedCount: importedLinks.length, 
      addedCount: merged.addedCount,
      duplicateCount: merged.duplicateCount
    };
  });

  ipcMain.handle('prompt-save', (_, prompt) => {
    const now = Date.now();
    const current = Array.isArray(settings.prompts) ? [...settings.prompts] : [];
    const existing = prompt && prompt.id ? current.find(item => item.id === prompt.id) : null;
    const normalized = normalizePrompt({
      ...existing,
      ...prompt,
      createdAt: existing?.createdAt || prompt?.createdAt
    }, now);

    const next = existing
      ? current.map(item => (item.id === normalized.id ? normalized : item))
      : [normalized, ...current];

    settings.prompts = next;
    persistSettings(settings);
    return { ok: true, prompt: normalized, prompts: next };
  });

  ipcMain.handle('prompt-delete', (_, promptId) => {
    const current = Array.isArray(settings.prompts) ? settings.prompts : [];
    settings.prompts = current.filter(item => item.id !== promptId);
    persistSettings(settings);
    return { ok: true, prompts: settings.prompts };
  });

  ipcMain.handle('link-save', async (_, link) => {
    const now = Date.now();
    const current = Array.isArray(settings.links) ? [...settings.links] : [];
    const existing = link && link.id ? current.find(item => item.id === link.id) : null;
    const nextUrl = normalizeText(link?.url);
    const shouldRefreshPreview = !existing || existing.url !== nextUrl || !existing.preview;
    const preview = shouldRefreshPreview
      ? await fetchLinkPreview(nextUrl, link?.name)
      : existing.preview;

    const normalized = normalizeLink({
      ...existing,
      ...link,
      preview: preview || existing?.preview,
      createdAt: existing?.createdAt || link?.createdAt
    }, now);

    const next = existing
      ? current.map(item => (item.id === normalized.id ? normalized : item))
      : [normalized, ...current];

    settings.links = next;
    persistSettings(settings);
    return { ok: true, link: normalized, links: next };
  });

  ipcMain.handle('link-delete', (_, linkId) => {
    const current = Array.isArray(settings.links) ? settings.links : [];
    settings.links = current.filter(item => item.id !== linkId);
    persistSettings(settings);
    return { ok: true, links: settings.links };
  });

  ipcMain.handle('link-toggle-read', (_, { id, read }) => {
    const now = Date.now();
    const current = Array.isArray(settings.links) ? settings.links : [];
    let updatedLink = null;

    settings.links = current.map((item) => {
      if (item.id !== id) return item;
      updatedLink = { ...item, read: !!read, updatedAt: now };
      return updatedLink;
    });

    persistSettings(settings);
    return { ok: true, link: updatedLink, links: settings.links };
  });

  ipcMain.handle('link-toggle-pin', (_, { id, pinned }) => {
    const now = Date.now();
    const current = Array.isArray(settings.links) ? settings.links : [];
    let updatedLink = null;

    settings.links = current.map((item) => {
      if (item.id !== id) return item;
      updatedLink = { ...item, pinned: !!pinned, updatedAt: now };
      return updatedLink;
    });

    persistSettings(settings);
    return { ok: true, link: updatedLink, links: settings.links };
  });

  Object.values(SERVICE_CONFIGS).forEach((cfg) => {
    ipcMain.on(`start-${cfg.key}`, () => {
      services.spawnService({ key: cfg.key });
    });

    ipcMain.on(`stop-${cfg.key}`, () => {
      services.stopService({ key: cfg.key });
    });

    ipcMain.on(`restart-${cfg.key}`, () => {
      services.restartService({ key: cfg.key });
    });
  });

  const UPDATE_MAP = {
    router: { pkg: '9router', label: '9Router' },
    openclaw: { pkg: 'openclaw', label: 'OpenClaw' }
  };

  Object.entries(UPDATE_MAP).forEach(([key, cfg]) => {
    ipcMain.on(`update-${key}`, (event) => {
      services.updatePackage({
        ...cfg,
        onProgress: (data) => event.reply('update-progress', data),
        onDone: (data) => event.reply('update-result', data)
      });
    });
  });

  ipcMain.on('shutdown-schedule', async (event, { seconds, mode }) => {
    const fn = mode === 'restart' ? shutdownTools.scheduleRestart : shutdownTools.scheduleShutdown;
    const result = await fn(seconds);
    event.reply('shutdown-scheduled', result);
  });

  ipcMain.on('shutdown-cancel', async (event) => {
    const result = await shutdownTools.cancelShutdown();
    event.reply('shutdown-cancelled', result);
  });

  ipcMain.on('shutdown-now', async () => {
    await shutdownTools.shutdownNow();
  });

  ipcMain.handle('idm-reset-trial', async () => {
    return await idmTools.resetIDMTrial();
  });

  ipcMain.handle('idm-check-running', async () => {
    return await idmTools.checkIDMRunning();
  });

  ipcMain.handle('anydesk-check', async () => {
    return await anydeskTools.checkAnyDeskRunning();
  });

  ipcMain.handle('anydesk-reset-id', async () => {
    return await anydeskTools.resetAnyDeskId();
  });

  // Network management handlers
  ipcMain.handle('network-get-adapters', async () => {
    return await networkTools.getAdapters();
  });

  ipcMain.handle('network-enable-adapter', async (event, name) => {
    return await networkTools.enableAdapter(name);
  });

  ipcMain.handle('network-disable-adapter', async (event, name) => {
    return await networkTools.disableAdapter(name);
  });

  ipcMain.handle('network-reset-adapter', async (event, name) => {
    return await networkTools.resetAdapter(name);
  });

  ipcMain.handle('network-flush-dns', async () => {
    return await networkTools.flushDNS();
  });

  ipcMain.handle('network-release-renew-ip', async (event, name) => {
    return await networkTools.releaseRenewIP(name);
  });

  ipcMain.handle('network-get-ip-config', async (event, name) => {
    return await networkTools.getIPConfig(name);
  });

  // Hardware info handlers
  ipcMain.handle('hardware-get-all', async () => {
    return await hardwareTools.getAllHardwareInfo();
  });

  ipcMain.handle('hardware-get-cpu', async () => {
    return await hardwareTools.getCPUInfo();
  });

  ipcMain.handle('hardware-get-memory', async () => {
    return await hardwareTools.getMemoryInfo();
  });

  ipcMain.handle('hardware-get-disk', async () => {
    return await hardwareTools.getDiskInfo();
  });

  ipcMain.handle('hardware-get-gpu', async () => {
    return await hardwareTools.getGPUInfo();
  });

  ipcMain.handle('hardware-get-network', async () => {
    return await hardwareTools.getNetworkInfo();
  });

  ipcMain.handle('hardware-get-system', async () => {
    return await hardwareTools.getSystemInfo();
  });

  ipcMain.handle('hardware-get-battery', async () => {
    return await hardwareTools.getBatteryInfo();
  });

  // Copy-Paste Sync handlers
  ipcMain.handle('copypaste-upload', async () => {
    const payload = sanitizeSettingsForSync(settings);
    const result = await copyPasteSync.uploadData(payload);
    
    if (result.ok) {
      settings.copypaste_code = result.code;
      settings.copypaste_uploaded_at = result.timestamp;
      persistSettings(settings);
    }
    
    return result;
  });

  ipcMain.handle('copypaste-download', async (_, code) => {
    const result = await copyPasteSync.downloadData(code);
    
    if (result.ok && result.data) {
      const keys = ['autoLaunch', 'autoHeal', 'startMinimized', 'autoStartRouter', 'autoStartOpenclaw', 'minimizeToTray', 'prompts', 'links', 'sync_url'];
      keys.forEach((key) => {
        if (result.data[key] !== undefined) {
          settings[key] = result.data[key];
        }
      });
      
      settings.copypaste_code = code;
      settings.copypaste_downloaded_at = result.timestamp;
      persistSettings(settings);
    }
    
    return result;
  });

  ipcMain.handle('copypaste-get-info', async () => {
    return {
      code: settings.copypaste_code || '',
      uploadedAt: settings.copypaste_uploaded_at || null,
      downloadedAt: settings.copypaste_downloaded_at || null
    };
  });

  // Kill Port handlers
  ipcMain.handle('killport-get-ports', async () => {
    return await killPortTools.getOpenPorts();
  });

  ipcMain.handle('killport-kill-process', async (event, pid) => {
    return await killPortTools.killProcess(pid);
  });

  ipcMain.handle('killport-kill-port', async (event, port) => {
    return await killPortTools.killPort(port);
  });

  ipcMain.handle('killport-find-port', async (event, port) => {
    return await killPortTools.findPortProcess(port);
  });

  return { broadcastStatus };
}

function setAutoLaunch(enable) {
  const appName = 'ServiceManager';
  const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

  if (enable) {
    exec(`reg add "${regKey}" /v "${appName}" /t REG_SZ /d "${process.execPath}" /f`);
  } else {
    exec(`reg delete "${regKey}" /v "${appName}" /f`);
  }
}

function checkAutoLaunch() {
  return new Promise((resolve) => {
    const appName = 'ServiceManager';
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    exec(`reg query "${regKey}" /v "${appName}"`, (err, stdout) => {
      resolve(!err && stdout.includes(appName));
    });
  });
}

module.exports = { register };
