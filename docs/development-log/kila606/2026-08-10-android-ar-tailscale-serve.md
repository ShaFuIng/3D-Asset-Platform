# Android AR 真機測試與 Tailscale Serve 設定

- 日期：2026-08-10
- 負責人：kila606
- 歷史開發分支：`kila606/ar-model-viewer`（相關功能已合併至 `main`）
- 相關 Commit：`2255252`、`5035808`

## 狀態補註

本頁保留 2026-08-10 當時的測試結果。2026-08-23 盤點確認相關程式與文件已進入
`main`。`kila606/ar-model-viewer` 僅保留為歷史開發分支；下列尚未完成的
真機放置與真實尺度驗證仍維持待辦，不因功能合併而視為完成。

## 本次目的

建立一條可讓 Android 真機透過 Tailscale Serve 的 HTTPS 網址連到本機前端、
FastAPI API 與 AR Viewer 的測試路徑。這次重點是修正前端相依版本衝突
（Dependency Conflict）、設定 Vite 同源代理（Same-origin Proxy），並記錄
私人網路（Tailnet）與 HTTPS 反向代理（HTTPS Reverse Proxy）的操作方式。

## 測試環境

- Windows 筆電
- 電腦 Tailscale 名稱：`your-windows-device`
- 電腦 Tailscale IP：`100.x.x.x`
- Android 手機：Samsung Galaxy Android phone
- 手機 Tailscale 名稱：`your-android-device`
- 手機 Tailscale IP：`100.y.y.y`
- HTTPS 網址：`https://your-device.your-tailnet.ts.net/`

## 架構與資料流

```text
ComfyUI 8188
    ↓
FastAPI 8000
    ↓
Vite 5173
    ↓
Tailscale Serve HTTPS
    ↓
Android Chrome / Google Scene Viewer
```

手機從 Tailscale Serve 的 HTTPS 網址開啟前端。前端同源呼叫 `/api`，由
Vite dev server proxy 到 `http://127.0.0.1:8000` 的 FastAPI。FastAPI 仍是
唯一會呼叫 ComfyUI 的後端服務；前端不直接連 ComfyUI，也不保存 API Key。

## 實際修改內容

- `frontend/package.json`：將 `three` 固定為精確版本 `0.183.2`。
- `frontend/package-lock.json`：同步鎖定 `three@0.183.2`，讓 `npm ci` 不需
  `--force` 或 `--legacy-peer-deps`。
- `frontend/vite.config.ts`：
  - 保持 Vite 監聽 `127.0.0.1:5173`。
  - 新增 `/api` proxy 到 `http://127.0.0.1:8000`。
  - 允許測試用 Tailscale Host：`your-device.your-tailnet.ts.net`。
  - 支援用 `.env` 的 `VITE_ALLOWED_HOSTS` 補充其他開發者自己的 host，避免使用
    `allowedHosts: true`。
- `.env.example`：新增非敏感的 `VITE_ALLOWED_HOSTS` 範例設定欄位；真正的
  `.env` 不提交。

## Tailscale Serve 設定步驟

確認裝置狀態：

```powershell
tailscale status
tailscale ping your-android-device
```

啟動 HTTPS 反向代理：

```powershell
tailscale serve --bg http://127.0.0.1:5173
```

查看目前 Serve 設定：

```powershell
tailscale serve status
```

停止 Serve：

```powershell
tailscale serve --https=443 off
```

## 啟動順序

1. 啟動 ComfyUI，確認 `8188` 可用。
2. 啟動 FastAPI：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

3. 啟動 Vite：

```powershell
cd frontend
npm run dev
```

4. 啟動 Tailscale Serve：

```powershell
tailscale serve --bg http://127.0.0.1:5173
```

5. 在 Android Chrome 開啟：

```text
https://your-device.your-tailnet.ts.net/
```

## Android Android phone 操作流程

1. Windows 筆電與 Android phone 登入同一個 Tailnet。
2. 在筆電確認 `tailscale ping your-android-device` 成功。
3. 確認 FastAPI 在 `127.0.0.1:8000` 啟動。
4. 確認 Vite 在 `127.0.0.1:5173` 啟動。
5. 啟動 Tailscale Serve。
6. 用 Android phone 的 Android Chrome 開啟 HTTPS 網址。
7. 進入包含 AR Viewer 的模型頁面後，再嘗試由 `<model-viewer>` 觸發
   Google Scene Viewer。

目前紀錄只證實 HTTPS 網址可連到 Vite、筆電端 `/api` proxy 可正常連線，
以及 Vite `allowedHosts` 已允許測試 host。手機重新整理後完整頁面載入與
Google Scene Viewer 成功放置模型仍列為待驗證。

## three 與 model-viewer 版本衝突

曾遇到 `@google/model-viewer@4.3.1` 要求 peer dependency：

```text
three@^0.183.0
```

原本專案使用 `three@0.185.1`，導致 `npm ci` 出現 `ERESOLVE`。本輪不使用
`--force` 或 `--legacy-peer-deps`，也不執行 `npm audit fix`。解法是執行：

```powershell
npm install three@0.183.2 --save-exact
```

並提交 `package.json` 與 `package-lock.json`，讓團隊可以用 `npm ci`
重現同一組相依版本。

## Vite Proxy 與 allowedHosts

本機 `.env` 可暫時設定：

```env
VITE_API_BASE_URL=
```

讓前端以同源 `/api` 呼叫後端。手機透過 Tailscale Serve HTTPS 網址存取時，
瀏覽器看到的 origin 是 `https://your-device.your-tailnet.ts.net`，所以
API 也走同源 `/api`，再由 Vite proxy 轉送到 FastAPI。

Vite `allowedHosts` 用來限制 dev server 接受哪些 Host header。手機最初曾被
Vite `allowedHosts` 阻擋，因此本輪加入測試用 Tailscale Host，但沒有使用
`allowedHosts: true`，避免無限制接受所有 host。

## 後續開發者換成自己的 Tailscale Host

後續開發者不需要修改 `vite.config.ts`。可在本機 `.env` 加入：

```env
VITE_ALLOWED_HOSTS=your-device.your-tailnet.ts.net
```

多個 host 用逗號分隔：

```env
VITE_ALLOWED_HOSTS=dev-a.tailnet.ts.net,dev-b.tailnet.ts.net
```

`.env` 只供本機使用，不可提交。

## 已驗證項目

- Windows 與 Android phone 已登入同一個 Tailnet。
- `tailscale ping your-android-device` 成功。
- Tailscale Serve 已啟動。
- HTTPS 網址成功連到 Vite。
- 手機最初曾被 Vite `allowedHosts` 阻擋。
- 已在 `vite.config.ts` 加入允許的 Tailscale Host。
- FastAPI 已在 `127.0.0.1:8000` 正常啟動。
- Vite 已在 `127.0.0.1:5173` 正常啟動。
- Vite `/api` Proxy 在筆電端可正常連線。
- npm 相依衝突已透過 `three@0.183.2` 修正。

## 待驗證項目與目前限制

- Android phone 重新整理後的完整頁面載入仍需再次人工確認。
- Google Scene Viewer 是否成功啟動並完成模型放置仍需真機測試。
- 模型真實尺度尚未驗證，不能視為準確真實比例；目前 `arScale` 只是手動顯示倍率，尚未寫入公分／毫米尺寸 metadata 或完成 GLB 尺度校正。
- iOS AR Quick Look 不屬於本輪 Android 真機測試結果。
- Tailscale Serve 是開發測試路徑，不等同正式部署。
