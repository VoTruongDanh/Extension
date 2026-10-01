const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { app } = require('electron');

// Lưu trữ các tunnel đang chạy: Map<number, TunnelInstance>
const tunnels = new Map();
let emitEvent = null;

// Thư mục lưu trữ binary độc lập nếu chưa cài global
function getLocalBinPath() {
  try {
    const userDataPath = app ? app.getPath('userData') : path.join(process.env.APPDATA || '', 'ServiceManager');
    const binDir = path.join(userDataPath, 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }
    return path.join(binDir, 'cloudflared.exe');
  } catch (err) {
    return path.join(process.cwd(), 'bin', 'cloudflared.exe');
  }
}

/**
 * Tìm binary cloudflared khả dụng (ưu tiên local bin trong userData, sau đó là PATH)
 */
function findCloudflaredBinary() {
  const localBin = getLocalBinPath();
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  // Kiểm tra trong PATH hệ thống
  try {
    const stdout = execSync('where.exe cloudflared', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch (_) {
    // Không có trong PATH
  }

  return null;
}

/**
 * Kiểm tra trạng thái cài đặt của Cloudflared
 */
async function checkInstalled() {
  const binaryPath = findCloudflaredBinary();
  if (!binaryPath) {
    return {
      installed: false,
      version: null,
      path: null
    };
  }

  return new Promise((resolve) => {
    exec(`"${binaryPath}" --version`, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          installed: false,
          version: null,
          path: binaryPath,
          error: err.message
        });
      } else {
        const output = (stdout || stderr || '').trim();
        // Ví dụ: cloudflared version 2024.2.1 (built 2024-02-14-1422 UTC)
        const match = output.match(/cloudflared\s+version\s+([^\s]+)/i) || output.match(/version\s+([^\s]+)/i);
        const version = match ? match[1] : output.split('\n')[0];
        resolve({
          installed: true,
          version: version,
          path: binaryPath
        });
      }
    });
  });
}

/**
 * Helper tải file có hỗ trợ chuyển hướng (redirect 301/302)
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const request = client.get(url, { headers: { 'User-Agent': 'ServiceManager-Downloader/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Chuyển hướng
        return resolve(downloadFile(res.headers.location, destPath, onProgress));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Tải xuống thất bại với HTTP status ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
      let downloadedBytes = 0;

      const fileStream = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (typeof onProgress === 'function') {
          const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
          onProgress({ downloadedBytes, totalBytes, percent });
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destPath));
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(err);
      });
    });

    request.on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(err);
    });
  });
}

/**
 * Tải và cài đặt tự động binary cloudflared.exe từ GitHub Release chính thức của Cloudflare
 */
async function installCloudflared(onProgress) {
  const targetPath = getLocalBinPath();
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  const tempPath = targetPath + '.tmp';

  try {
    await downloadFile(downloadUrl, tempPath, onProgress);
    if (fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
    fs.renameSync(tempPath, targetPath);

    const check = await checkInstalled();
    return { ok: true, path: targetPath, version: check.version };
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    throw new Error(`Lỗi cài đặt cloudflared: ${error.message}`);
  }
}

/**
 * Khởi tạo mở cổng Tunnel qua Cloudflare
 */
async function startTunnel({ port, protocol = 'http', noTlsVerify = false, host = 'localhost' }) {
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('Số cổng không hợp lệ (phải từ 1 đến 65535)');
  }

  // Nếu tunnel của cổng này đang chạy, trả về thông tin hiện tại
  if (tunnels.has(portNum)) {
    const existing = tunnels.get(portNum);
    if (existing.status === 'online' || existing.status === 'starting') {
      return sanitizeTunnel(existing);
    }
  }

  const binaryPath = findCloudflaredBinary();
  if (!binaryPath) {
    throw new Error('Chưa tìm thấy cloudflared. Hãy nhấn nút "Cài đặt Cloudflared" trước khi mở cổng.');
  }

  const targetUrl = `${protocol}://${host}:${portNum}`;
  const args = ['tunnel', '--url', targetUrl];
  if (noTlsVerify) {
    args.push('--no-tls-verify');
  }

  const tunnelInstance = {
    id: `tunnel_${portNum}_${Date.now()}`,
    port: portNum,
    protocol,
    host,
    targetUrl,
    publicUrl: null,
    status: 'starting', // starting | online | stopped | error
    startedAt: Date.now(),
    stoppedAt: null,
    pid: null,
    process: null,
    logs: [],
    metrics: {
      requestCount: 0,
      connections: 0,
      lastEventTime: Date.now()
    }
  };

  tunnels.set(portNum, tunnelInstance);

  return new Promise((resolve, reject) => {
    let hasResolved = false;
    let spawnError = null;

    try {
      const child = spawn(binaryPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      tunnelInstance.process = child;
      tunnelInstance.pid = child.pid;

      const appendLog = (rawText, isErrorStream = false) => {
        const text = String(rawText || '').trim();
        if (!text) return;

        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Lưu tối đa 300 dòng log
          const logEntry = {
            time: Date.now(),
            text: trimmed,
            isError: isErrorStream
          };

          tunnelInstance.logs.push(logEntry);
          if (tunnelInstance.logs.length > 300) {
            tunnelInstance.logs.shift();
          }

          // Phân tích tìm URL Quick Tunnel Cloudflare
          // Định dạng thường gặp: https://[a-zA-Z0-9-]+\.trycloudflare\.com
          const urlMatch = trimmed.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
          if (urlMatch && !tunnelInstance.publicUrl) {
            tunnelInstance.publicUrl = urlMatch[0];
            tunnelInstance.status = 'online';

            if (emitEvent) {
              emitEvent('cloudflared-status-changed', sanitizeTunnel(tunnelInstance));
            }

            if (!hasResolved) {
              hasResolved = true;
              resolve(sanitizeTunnel(tunnelInstance));
            }
          }

          // Đếm các request hoặc connection
          if (trimmed.includes('Registered tunnel connection') || trimmed.includes('Connection registered')) {
            tunnelInstance.metrics.connections += 1;
            tunnelInstance.metrics.lastEventTime = Date.now();
          }

          if (emitEvent) {
            emitEvent('cloudflared-log', {
              port: portNum,
              log: logEntry
            });
          }
        }
      };

      child.stdout.on('data', (data) => appendLog(data.toString('utf8'), false));
      child.stderr.on('data', (data) => appendLog(data.toString('utf8'), true));

      child.on('error', (err) => {
        spawnError = err;
        tunnelInstance.status = 'error';
        tunnelInstance.stoppedAt = Date.now();
        appendLog(`[ERROR] Không thể khởi động process: ${err.message}`, true);

        if (emitEvent) {
          emitEvent('cloudflared-status-changed', sanitizeTunnel(tunnelInstance));
        }

        if (!hasResolved) {
          hasResolved = true;
          reject(new Error(`Không thể khởi chạy cloudflared: ${err.message}`));
        }
      });

      child.on('close', (code, signal) => {
        tunnelInstance.stoppedAt = Date.now();
        if (tunnelInstance.status !== 'error') {
          tunnelInstance.status = 'stopped';
        }
        appendLog(`[INFO] Tunnel cổng ${portNum} đã dừng (code: ${code}, signal: ${signal})`, false);

        if (emitEvent) {
          emitEvent('cloudflared-status-changed', sanitizeTunnel(tunnelInstance));
        }

        if (!hasResolved) {
          hasResolved = true;
          reject(new Error(`Cloudflared thoát trước khi tạo được đường dẫn công khai (exit code: ${code})`));
        }
      });

      // Timeout dự phòng sau 25s nếu không nhận được URL
      setTimeout(() => {
        if (!hasResolved && tunnelInstance.status === 'starting') {
          hasResolved = true;
          if (tunnelInstance.publicUrl) {
            resolve(sanitizeTunnel(tunnelInstance));
          } else {
            reject(new Error('Hết thời gian chờ phản hồi từ Cloudflare. Vui lòng kiểm tra kết nối mạng của bạn.'));
          }
        }
      }, 25000);

    } catch (err) {
      tunnelInstance.status = 'error';
      tunnelInstance.stoppedAt = Date.now();
      tunnels.delete(portNum);
      if (!hasResolved) {
        hasResolved = true;
        reject(err);
      }
    }
  });
}

/**
 * Dừng 1 tunnel theo cổng
 */
async function stopTunnel(port) {
  const portNum = parseInt(port, 10);
  const tunnel = tunnels.get(portNum);
  if (!tunnel) {
    return { ok: true, message: 'Tunnel không tồn tại hoặc đã dừng' };
  }

  tunnel.status = 'stopped';
  tunnel.stoppedAt = Date.now();

  if (tunnel.process && tunnel.pid) {
    try {
      // Dùng taskkill để diệt cả cây tiến trình trên Windows
      exec(`taskkill /F /T /PID ${tunnel.pid}`, { windowsHide: true }, () => {});
    } catch (_) {
      try { tunnel.process.kill(); } catch (_) {}
    }
  }

  if (emitEvent) {
    emitEvent('cloudflared-status-changed', sanitizeTunnel(tunnel));
  }

  return { ok: true, port: portNum };
}

/**
 * Dừng tất cả các tunnel đang chạy
 */
async function stopAllTunnels() {
  const promises = [];
  for (const [port, tunnel] of tunnels.entries()) {
    if (tunnel.status === 'online' || tunnel.status === 'starting') {
      promises.push(stopTunnel(port));
    }
  }
  await Promise.all(promises);
  return { ok: true, count: promises.length };
}

/**
 * Xóa hẳn một tunnel khỏi danh sách lịch sử theo dõi
 */
function removeTunnel(port) {
  const portNum = parseInt(port, 10);
  const tunnel = tunnels.get(portNum);
  if (tunnel) {
    if (tunnel.status === 'online' || tunnel.status === 'starting') {
      stopTunnel(portNum);
    }
    tunnels.delete(portNum);
  }
  return { ok: true, port: portNum };
}

/**
 * Lấy danh sách thông tin các tunnel
 */
function getTunnels() {
  const list = [];
  for (const tunnel of tunnels.values()) {
    list.push(sanitizeTunnel(tunnel));
  }
  return list;
}

/**
 * Lấy log của 1 tunnel
 */
function getLogs(port) {
  const portNum = parseInt(port, 10);
  const tunnel = tunnels.get(portNum);
  return tunnel ? tunnel.logs : [];
}

/**
 * Chuẩn hóa object trước khi gửi sang renderer (loại bỏ process object để tránh circular reference)
 */
function sanitizeTunnel(t) {
  return {
    id: t.id,
    port: t.port,
    protocol: t.protocol,
    host: t.host,
    targetUrl: t.targetUrl,
    publicUrl: t.publicUrl,
    status: t.status,
    startedAt: t.startedAt,
    stoppedAt: t.stoppedAt,
    pid: t.pid,
    metrics: t.metrics,
    logsCount: t.logs ? t.logs.length : 0
  };
}

/**
 * Dọn dẹp đồng bộ khi ứng dụng đóng
 */
function cleanupAllSync() {
  for (const tunnel of tunnels.values()) {
    if (tunnel.pid) {
      try {
        execSync(`taskkill /F /T /PID ${tunnel.pid}`, { windowsHide: true, stdio: 'ignore' });
      } catch (_) {}
    }
  }
  tunnels.clear();
}

function initCloudflared({ emit }) {
  emitEvent = emit;
}

module.exports = {
  initCloudflared,
  checkInstalled,
  installCloudflared,
  startTunnel,
  stopTunnel,
  stopAllTunnels,
  removeTunnel,
  getTunnels,
  getLogs,
  cleanupAllSync
};
