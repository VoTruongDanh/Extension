# Extention

Tiện ích máy tính - Ứng dụng Electron cung cấp các công cụ quản lý hệ thống, mạng, phần cứng và tiện ích khác trên Windows.

## Chạy và build

```bash
npm start
npm run build
```

- `npm start`: chạy app local bằng Electron
- `npm run build`: build installer Windows bằng `electron-builder`

## Tính năng chính

### Kill Port 🆕
- Hiển thị tất cả các port đang listening trên hệ thống
- Xem thông tin chi tiết: Process name, PID, Protocol, Address
- Kill port/process với một click
- Tự động phát hiện loại port (Development, Web Server, Database, System...)
- Tìm kiếm port theo số port, process name, hoặc PID
- Auto-refresh mỗi 5 giây
- **Lưu ý**: Cần quyền Administrator để kill process

### Các tính năng khác
- Quản lý services (9Router, OpenClaw)
- Quản lý mạng (Network adapters, IP, DNS)
- Thông tin phần cứng (CPU, RAM, Disk, GPU)
- Hẹn giờ tắt máy/restart
- Reset IDM trial, AnyDesk ID
- Thư viện Prompts và Links
- Scheduler/Nhắc nhở

## Cấu trúc hiện tại

```text
.
├─ index.html                     # app shell, mount HTML partials rồi boot renderer
├─ style.css                      # CSS manifest, chỉ @import các CSS chunk
├─ src/
│  ├─ main/
│  │  ├─ index.js                 # Electron app lifecycle
│  │  ├─ ipc.js                   # đăng ký IPC handlers
│  │  ├─ services.js              # start/stop/restart services
│  │  ├─ settings.js              # load/save settings.json
│  │  ├─ tray.js                  # system tray
│  │  └─ tools/                   # tool phía main process
│  │     ├─ shutdown.js
│  │     ├─ network.js
│  │     ├─ hardware.js
│  │     ├─ kill-port.js          # 🆕 Kill port tool
│  │     ├─ idm-reset.js
│  │     ├─ anydesk-reset.js
│  │     └─ copy-paste-sync.js
│  └─ renderer/
│     ├─ index.js                 # renderer orchestration
│     ├─ state.js                 # runtime state
│     ├─ ui.js                    # DOM helpers dùng chung
│     ├─ bootstrap/
│     │  ├─ htmlPartials.js       # mount partial HTML trước khi renderer boot
│     │  ├─ navigation.js         # switch view + bind nav
│     │  └─ theme.js              # theme toggle bootstrap
│     ├─ components/              # component JS dùng lại
│     ├─ partials/
│     │  ├─ sidebar.html
│     │  ├─ command-palette.html
│     │  ├─ modals/
│     │  └─ views/                # mỗi view lớn là một partial HTML
│     │     ├─ killport.html      # 🆕 Kill Port view
│     │     └─ ...
│     ├─ styles/
│     │  ├─ 01-tokens-reset.css
│     │  ├─ 02-shell-layout.css
│     │  ├─ 03-dashboard-shared.css
│     │  ├─ 04-settings-panels.css
│     │  ├─ 05-shutdown-reset.css
│     │  ├─ 06-library-workspaces.css
│     │  └─ 07-tools-hardware.css  # (bao gồm Kill Port styles)
│     └─ views/                   # logic JS cho từng view/tool
│        └─ tools/
│           ├─ killport.js        # 🆕 Kill Port logic
│           └─ ...
└─ README.md
```

## Kiến trúc UI

### 1. HTML shell + partial

- `index.html` chỉ giữ app shell.
- Nội dung thật nằm trong `src/renderer/partials/**`.
- `src/renderer/bootstrap/htmlPartials.js` thay các node `data-include="..."` bằng nội dung partial tương ứng trước khi `src/renderer/index.js` chạy.

**CRITICAL: View Structure Pattern**

Tất cả views PHẢI tuân theo cấu trúc này:

```html
<div id="view-{name}" class="view" style="display: none;">
  <header class="header">
    <div>
      <h1>View Title</h1>
      <p class="subtitle">View description</p>
    </div>
    <div class="header-right">
      <!-- Action buttons -->
    </div>
  </header>
  
  <!-- View content here -->
</div>
```

**Standard Classes:**
- `.header` - View header container (NOT `.view-header`)
- `.subtitle` - Description text (NOT `.view-description`)
- `.header-right` - Action buttons container (NOT `.view-header-actions`)
- `#view-{name}` - ID MUST match view name in navigation

**Common Mistakes:**
- ❌ Missing `<div id="view-{name}">` wrapper → CSS won't apply
- ❌ Using custom header classes → Styles won't work
- ❌ Missing `style="display: none;"` → View shows on load

Khi thêm view mới:

1. Tạo partial HTML trong `src/renderer/partials/views/` với ĐÚNG structure pattern.
2. Thêm một dòng `data-include` vào `index.html`.
3. Tạo file logic trong `src/renderer/views/` hoặc `src/renderer/views/tools/`.
4. Đăng ký view trong `src/renderer/index.js` với ID matching pattern.
5. Verify CSS applies bằng cách check có `.header` styling.

### 2. CSS manifest + chunk

- `style.css` không chứa CSS dài nữa, chỉ import các file trong `src/renderer/styles/`.
- Chia file theo trách nhiệm lớn để tránh một file 4000+ dòng.

Nguyên tắc:

- Style dùng chung: đưa vào chunk phù hợp hiện có.
- Style quá đặc thù cho một view/tool: ưu tiên đặt gần block chunk của view đó.
- Nếu một nhóm style đủ lớn và có lifecycle riêng, tách thêm chunk mới rồi import từ `style.css`.

### 3. Renderer bootstrap

`src/renderer/index.js` hiện chỉ làm orchestration:

- init theme
- init navigation
- bind quick links
- init các view/components
- boot command palette

Không nên nhét thêm HTML dài hoặc logic UI chi tiết vào đây.

## Cách thêm/chỉnh view

### Thêm một tool/view mới

1. Tạo HTML ở `src/renderer/partials/views/my-tool.html`.
2. Thêm `data-include="src/renderer/partials/views/my-tool.html"` vào `index.html`.
3. Tạo logic ở `src/renderer/views/tools/my-tool.js`.
4. Import và init trong `src/renderer/index.js`.
5. Nếu cần backend, thêm IPC/tool ở `src/main/ipc.js` hoặc `src/main/tools/`.

### Chỉnh giao diện một view có sẵn

- Chỉnh markup ở partial HTML tương ứng trong `src/renderer/partials/views/`.
- Chỉnh hành vi ở file JS tương ứng trong `src/renderer/views/`.
- Chỉnh style ở chunk CSS phù hợp trong `src/renderer/styles/`.

## Cách thêm service mới

Luồng hiện tại chưa hoàn toàn config-driven, nên thêm service mới vẫn cần sửa nhiều điểm.

Các điểm chính:

1. Thêm config và IPC trong `src/main/ipc.js`
2. Thêm runtime/state trong `src/main/services.js`
3. Thêm state renderer trong `src/renderer/state.js`
4. Thêm card HTML ở partial dashboard
5. Bind UI trong `src/renderer/views/dashboard.js`
6. Nếu cần tray/control riêng, cập nhật `src/main/tray.js`

## Lưu ý encoding tiếng Việt

Project này có nhiều text tiếng Việt trong HTML/JS/README, nên:

- luôn lưu file text dưới dạng `UTF-8`
- không convert qua ANSI/Windows-1258
- khi script hóa việc tách/generate file, phải ghi rõ encoding `utf8`

Nếu UI hiển thị tiếng Việt bị vỡ ký tự, nguyên nhân gần như chắc là file đã bị ghi sai encoding ở một bước refactor hoặc script hóa.

## Settings file

File settings được lưu tại:

```text
%APPDATA%\claw-router-manager\settings.json
```

Một số key chính:

| Key | Ý nghĩa |
| --- | --- |
| `autoLaunch` | mở cùng Windows |
| `startMinimized` | khởi động thu nhỏ |
| `autoStartRouter` | tự chạy 9Router |
| `autoStartOpenclaw` | tự chạy OpenClaw |
| `minimizeToTray` | đóng thì ẩn xuống tray |
| `autoHeal` | tự restart service khi crash/mất phản hồi |
| `prompts` | thư viện prompt |
| `links` | thư viện link |
| `sync_url` | Google Sheets CSV sync URL |

## Gợi ý bảo trì tiếp theo

- Tách `src/main/ipc.js` thành nhiều module đăng ký IPC nhỏ hơn.
- Làm service registry dùng chung cho `main`, `renderer`, `tray`.
- Tiếp tục chia sâu CSS chunk hiện tại thành `base/components/views/tools` nếu số lượng tool tăng thêm.
