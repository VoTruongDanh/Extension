const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Kill IDM processes trước khi reset
 */
function killIDMProcesses() {
  return new Promise((resolve) => {
    exec('taskkill /F /IM IDMan.exe /T & taskkill /F /IM IEMonitor.exe /T', (err) => {
      // Không quan trọng nếu process không tồn tại
      resolve({ ok: true });
    });
  });
}

/**
 * Sử dụng regini để khôi phục quyền truy cập đầy đủ cho các khóa CLSID bị khóa
 */
function runRegini(content) {
  return new Promise((resolve) => {
    const tempFile = path.join(os.tmpdir(), `idm_regini_${Date.now()}.txt`);
    try {
      fs.writeFileSync(tempFile, content, 'utf8');
      exec(`regini "${tempFile}"`, (err) => {
        try {
          fs.unlinkSync(tempFile);
        } catch (_) {}
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Các registry key liên quan tới trial IDM — dùng chung cho backup và reset
const IDM_REG_KEYS = [
  'HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager',
  'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}',
  'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}',
  'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{5ED60779-4DE2-4E07-B862-974CA4FF2E9C}',
  'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{5ED60779-4DE2-4E07-B862-974CA4FF2E9C}',
  'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{7B8E9164-324D-4A2E-A46D-0165FB2000EC}',
  'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{7B8E9164-324D-4A2E-A46D-0165FB2000EC}',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Wow6432Node\\Internet Download Manager',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Internet Download Manager'
];

/**
 * Sao lưu các registry key IDM ra file .reg trước khi reset để có thể khôi phục.
 * Trả về đường dẫn file backup nếu có ít nhất một key được export.
 */
async function backupIDMRegistry() {
  const backupDir = path.join(process.env.APPDATA || os.tmpdir(), 'Extention', 'idm-backups');
  try {
    fs.mkdirSync(backupDir, { recursive: true });
  } catch (_) {
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `idm-registry-${stamp}.reg`);
  let exportedAny = false;

  for (const key of IDM_REG_KEYS) {
    // Export nối tiếp vào cùng một file; /y ghi đè file tạm mỗi key rồi gộp
    const tempExport = path.join(os.tmpdir(), `idm_bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.reg`);
    const ok = await new Promise((resolve) => {
      exec(`reg export "${key}" "${tempExport}" /y`, (err) => resolve(!err));
    });

    if (ok && fs.existsSync(tempExport)) {
      try {
        const content = fs.readFileSync(tempExport, 'utf16le');
        // File .reg đầu tiên giữ header "Windows Registry Editor..."; các file sau bỏ header
        const body = exportedAny ? content.replace(/^﻿?Windows Registry Editor[^\r\n]*\r?\n/, '') : content;
        fs.appendFileSync(backupFile, body, 'utf16le');
        exportedAny = true;
      } catch (_) {}
      try { fs.unlinkSync(tempExport); } catch (_) {}
    }
  }

  return exportedAny ? backupFile : null;
}

/**
 * Reset IDM trial bằng cách:
 * 0. Backup registry ra file .reg
 * 1. Kill IDM processes
 * 2. Mở khóa registry (regini)
 * 3. Xóa registry keys (ConfigTime, MData, scansk, tvfrdt, radxcnt...)
 * 4. Reset Thread=1, Model=0x68
 * 5. Xóa folder %appdata%\IDM
 */
async function resetIDMTrial() {
  try {
    // Step 0: Backup registry để có thể khôi phục
    const backupFile = await backupIDMRegistry();

    // Step 1: Kill processes
    await killIDMProcesses();
    await delay(1000); // Đợi 1 giây để hệ thống giải phóng các tệp tin và registry handles

    // Step 2: Mở khóa registry keys bằng regini
    const reginiContent = [
      'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{5ED60779-4DE2-4E07-B862-974CA4FF2E9C} [1 5 7 17]',
      'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{5ED60779-4DE2-4E07-B862-974CA4FF2E9C} [1 5 7 17]',
      'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7} [1 5 7 17]',
      'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7} [1 5 7 17]',
      'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{7B8E9164-324D-4A2E-A46D-0165FB2000EC} [1 5 7 17]',
      'HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{7B8E9164-324D-4A2E-A46D-0165FB2000EC} [1 5 7 17]'
    ].join('\r\n');
    await runRegini(reginiContent);

    // Step 3: Delete registry keys và reset values
    const regCommands = [
      // Xóa các mốc thời gian trial trong DownloadManager (đây là các VALUE, không phải subkey)
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v ConfigTime /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v FakeLastUsedTime /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v LastUsedTime /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v tvfrdt /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v scansk /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v radxcnt /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v LstCheck /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v LastCheckQU /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v Serial /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v FName /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v LName /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v Email /f',

      // Reset CLSID {07999AC3-058B-40BF-984F-69EB1E554CA7}
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}" /v MData /f',
      'reg add "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}" /v Therad /t REG_DWORD /d 1 /f',
      'reg add "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}" /v Model /t REG_DWORD /d 0x68 /f',

      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}" /v MData /f',
      'reg add "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}" /v Therad /t REG_DWORD /d 1 /f',
      'reg add "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{07999AC3-058B-40BF-984F-69EB1E554CA7}" /v Model /t REG_DWORD /d 0x68 /f',

      // Xóa hoàn toàn CLSID {5ED60779-4DE2-4E07-B862-974CA4FF2E9C}
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{5ED60779-4DE2-4E07-B862-974CA4FF2E9C}" /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{5ED60779-4DE2-4E07-B862-974CA4FF2E9C}" /f',

      // Xóa hoàn toàn CLSID {7B8E9164-324D-4A2E-A46D-0165FB2000EC}
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{7B8E9164-324D-4A2E-A46D-0165FB2000EC}" /f',
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\Classes\\CLSID\\{7B8E9164-324D-4A2E-A46D-0165FB2000EC}" /f',

      // Xóa hoàn toàn cấu hình IDM trong HKLM (Yêu cầu quyền Admin)
      'reg delete "HKEY_LOCAL_MACHINE\\SOFTWARE\\Wow6432Node\\Internet Download Manager" /f',
      'reg delete "HKEY_LOCAL_MACHINE\\SOFTWARE\\Internet Download Manager" /f'
    ];

    for (const cmd of regCommands) {
      await new Promise((resolve) => {
        exec(cmd, () => {
          // Bỏ qua tất cả lỗi khi xóa/thêm registry trong chế độ reset
          resolve();
        });
      });
    }

    // Step 4: Xóa folder %appdata%\IDM
    const idmFolder = path.join(process.env.APPDATA, 'IDM');
    if (fs.existsSync(idmFolder)) {
      await new Promise((resolve) => {
        exec(`rmdir /S /Q "${idmFolder}"`, () => {
          // Bỏ qua lỗi khóa thư mục nếu có, vì registry quan trọng nhất đã được xóa/reset thành công
          resolve();
        });
      });
    }

    return { ok: true, backupFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Kiểm tra xem IDM có đang chạy không và số ngày trial còn lại
 */
function checkIDMRunning() {
  return new Promise((resolve) => {
    // Check process
    exec('tasklist /FI "IMAGENAME eq IDMan.exe"', (err, stdout) => {
      if (err) return resolve({ running: false, daysLeft: null, error: 'Không thể kiểm tra process' });
      const running = stdout.includes('IDMan.exe');
      
      // Check trial days left từ registry
      const regQuery = 'reg query "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager" /v FakeLastUsedTime';
      
      exec(regQuery, (regErr, regOut) => {
        let daysLeft = null;
        let installDate = null;
        
        if (!regErr && regOut) {
          try {
            // FakeLastUsedTime hoặc LastUsedTime chứa timestamp
            const match = regOut.match(/FakeLastUsedTime\s+REG_BINARY\s+([0-9A-Fa-f\s]+)/);
            if (match) {
              const hexData = match[1].replace(/\s/g, '');
              
              if (hexData.length >= 16) {
                // Parse 8 bytes little-endian FILETIME
                const bytes = [];
                for (let i = 0; i < 16; i += 2) {
                  bytes.push(parseInt(hexData.substr(i, 2), 16));
                }
                
                // Combine bytes to 64-bit integer (little-endian)
                let filetime = 0;
                for (let i = 0; i < 8; i++) {
                  filetime += bytes[i] * Math.pow(2, i * 8);
                }
                
                // Convert FILETIME (100-nanosecond intervals since 1601-01-01) to JS Date
                const FILETIME_EPOCH_DIFF = 116444736000000000n; // 100-ns intervals between 1601 and 1970
                const unixMs = Number((BigInt(Math.floor(filetime)) - FILETIME_EPOCH_DIFF) / 10000n);
                installDate = new Date(unixMs);
                
                const now = new Date();
                const daysPassed = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
                daysLeft = Math.max(0, 30 - daysPassed);
              }
            }
          } catch (e) {
            console.error('[IDM] Parse error:', e);
          }
        }
        
        // Nếu không parse được, thử cách đơn giản hơn
        if (daysLeft === null) {
          exec('reg query "HKEY_CURRENT_USER\\SOFTWARE\\DownloadManager"', (err2, out2) => {
            if (!err2 && out2) {
              // Nếu có key DownloadManager nghĩa là đã cài, giả sử còn trial
              // Không parse được chính xác thì báo "Không xác định"
              resolve({ running, daysLeft: null, hasRegistry: true });
            } else {
              resolve({ running, daysLeft: null, hasRegistry: false });
            }
          });
          return;
        }
        
        resolve({ running, daysLeft, installDate: installDate ? installDate.toISOString() : null });
      });
    });
  });
}

module.exports = { resetIDMTrial, checkIDMRunning, killIDMProcesses };
