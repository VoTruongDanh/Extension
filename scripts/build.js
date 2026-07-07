const { build } = require('electron-builder');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

async function cleanDist() {
  if (fs.existsSync(DIST_DIR)) {
    console.log('🧹 Dọn dẹp thư mục dist cũ...');
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
}

async function buildApp() {
  console.log('🔨 Đang build NSIS + Portable...');
  const result = await build({
    config: {
      appId: 'com.extension.app',
      productName: 'Extention',
      directories: { 
        output: 'dist'
      },
      files: [
        'src/main/**/*',
        'src/renderer/**/*',
        'index.html',
        'style.css',
        'icon.png',
        'icon.ico',
        'node_modules/**/*',
        'package.json'
      ],
      win: {
        icon: 'icon.ico',
        requestedExecutionLevel: 'requireAdministrator',
        target: [
          { target: 'nsis', arch: 'x64' },
          { target: 'portable', arch: 'x64' }
        ]
      },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'Extention'
      },
      portable: {
        artifactName: '${productName}-Portable-${version}.${ext}'
      }
    },
    publish: null
  });
  console.log('✅ Build hoàn tất.');
  return result;
}

async function listOutputs() {
  if (!fs.existsSync(DIST_DIR)) return;
  const files = fs.readdirSync(DIST_DIR);
  if (files.length === 0) return;
  console.log('\n📦 Các file đã được tạo trong thư mục dist:');
  files.forEach(f => {
    const fpath = path.join(DIST_DIR, f);
    const stats = fs.statSync(fpath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`   - ${f} (${sizeMB} MB)`);
  });
}

(async () => {
  try {
    await cleanDist();
    await buildApp();
    await listOutputs();
    console.log('\n🎉 Đóng gói hoàn tất! Kiểm tra thư mục dist/');
  } catch (err) {
    console.error('\n❌ Lỗi trong quá trình build:', err.message);
    process.exit(1);
  }
})();
