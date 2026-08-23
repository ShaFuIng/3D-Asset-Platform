# 專案文件與團隊安裝指南

本文件是 `3D-Asset-Platform` 的主要技術文件入口。新加入的組員或接手
專案的 AI，應先閱讀本頁，再依負責範圍查看對應的開發紀錄。

> 狀態基準（2026-08-23）：`kila606/ar-model-viewer` 的 AR／USDZ／Tailscale Serve
> 功能已合併至 `main`；該分支僅保留歷史開發用途，一般開發請直接使用 `main`。

## 文件導航

| 文件 | 用途 |
|---|---|
| [根目錄 README](../README.md) | 專案目標、MVP 進度與待辦 |
| [AGENTS.md](../AGENTS.md) | 開發限制與協作規則 |
| [開發紀錄說明](./development-log/README.md) | 紀錄命名、撰寫時機與格式 |
| [Shafuing 開發紀錄](./development-log/shafuing/README.md) | 圖片、3D、Multiview、Asset Library 與交接狀態 |
| [kila606 開發紀錄](./development-log/kila606/README.md) | AR Viewer、USDZ、Android / iOS 與 Tailscale Serve |

## 目前階段

目前 `main` 已完成可操作的單圖與多視角 3D MVP，並包含：

- Vite + React + TypeScript 分階段前端
- OpenAI 圖片生成、指定圖片修改與 Multiview GPT Edit
- 本機圖片上傳、Reference 選擇、隱藏／恢復
- Video Frame Picker：從本機影片擷取單張 Reference Image
- Single Image 3D Job、輪詢、GLB 預覽與下載
- Qwen Front／Left／Back 三視圖生成與 Hunyuan Multiview 3D
- 單一視角本機重新抽選、GPT 修改、Candidate 接受與版本歷史
- SQLite Asset Catalog 與 Asset Library
- 圖片／模型搜尋、篩選、預覽、下載、Trash、Restore、Permanent Delete
- Three.js Original／Clay／Normal／Wireframe 模型檢查
- `@google/model-viewer` Web AR Viewer
- Android Google Scene Viewer AR 路徑
- iOS Quick Look / USDZ 路徑
- Blender headless GLB → USDZ 轉換服務
- Tailscale Serve HTTPS 真機測試路徑
- Game UI 第一版、首頁三區布局、orbital workspace 入口與統一五階段導覽

目前尚未完成：

- Job、Multiview 工作階段與版本歷史的跨重啟持久化
- Mesh 拆分、材質編輯、拓樸處理與骨架／IK
- 多 worker 共用狀態與正式任務佇列
- 模型真實尺寸 metadata、GLB 尺度校正、AR 固定比例與尺寸驗證
- Depth Anything 場景重建、尺度校正與桌面端虛擬擺放（目前僅為研究方向，未整合進平台）
- 完整逐頁 UI QA、RWD 細節與正式視覺 polish
- 正式環境的長時間生成與部署驗證
- Android Scene Viewer 完整模型放置仍需持續真機驗證
- iOS Quick Look / USDZ 仍需實機完整驗證

## 環境與版本

### 執行環境

| 工具 | 建議或已驗證版本 |
|---|---|
| Node.js | 建議 Node.js 22 LTS；Vite 8 至少需要 `^20.19.0` 或 `>=22.12.0` |
| npm | 使用 Node.js 隨附版本，並由 `package-lock.json` 鎖定依賴 |
| Python | 已驗證 Python `3.10.11`；開發者亦可依目前 requirements 建立相容環境 |
| ComfyUI | 本機 API 預設為 `http://127.0.0.1:8188` |
| Blender | `main` 的 iOS USDZ 轉換需要可執行 Blender headless |
| Tailscale | 僅開發／真機測試需要；用於 Tailnet HTTPS 存取 |

### 前端主要套件

宣告範圍以 `frontend/package.json` 為準，實際安裝版本由
`frontend/package-lock.json` 鎖定：

| 套件 | 宣告版本 |
|---|---|
| React | `^19.1.0` |
| React DOM | `^19.1.0` |
| React Router DOM | `^7.18.2` |
| Three.js | `0.183.2`（精確鎖定） |
| `@google/model-viewer` | `^4.3.1` |
| TypeScript | `^5.8.3` |
| Vite | `^8.1.5` |
| `@vitejs/plugin-react` | `^6.0.4` |

`three@0.183.2` 是為了符合目前 `@google/model-viewer@4.3.1` 的 peer dependency，
不要自行升回 `0.185.x` 後直接提交；若要升級，需重新驗證 npm 相依與 AR Viewer。

### 後端主要套件

版本以 `backend/requirements.txt` 為準：

| 套件 | 版本 |
|---|---|
| FastAPI | `0.116.1` |
| Uvicorn | `0.35.0` |
| HTTPX | `0.28.1` |
| python-dotenv | `1.1.1` |
| OpenAI Python SDK | `2.11.0` |
| python-multipart | `0.0.20` |
| Pillow | `12.1.0` |
| pytest | `9.0.2` |

SQLite 使用 Python 標準函式庫，不需要額外安裝套件。

## 團隊安裝方式

以下指令適用於 Windows PowerShell。不要照抄其他人的本機絕對路徑。

### 1. Clone Repository

```powershell
git clone https://github.com/ShaFuIng/3D-Asset-Platform.git
cd 3D-Asset-Platform
```

`main` 已包含目前的 AR／USDZ／Tailscale Serve 功能，不需要另外切換 AR 分支。
`kila606/ar-model-viewer` 僅保留為歷史開發分支，不應作為最新部署狀態的判斷依據。

### 2. 建立本機環境設定

```powershell
Copy-Item .env.example .env
```

範例內容：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_ALLOWED_HOSTS=
COMFYUI_BASE_URL=http://127.0.0.1:8188
OPENAI_API_KEY=
OPENAI_RESPONSE_MODEL=gpt-5.6
```

- `.env` 僅供本機使用，不可 Commit。
- `OPENAI_API_KEY` 只能放在後端環境，不可寫入前端。
- FastAPI 會讀取根目錄 `.env`。
- `frontend/vite.config.ts` 使用根目錄環境設定。
- `VITE_ALLOWED_HOSTS` 用於 Tailscale Serve 或其他開發 HTTPS reverse proxy 的 Host。

### 3. 安裝前端

```powershell
cd frontend
npm ci
cd ..
```

團隊安裝建議使用 `npm ci`，確保依照 `package-lock.json` 安裝相同版本。
目前 `main` 已修正 model-viewer / Three.js 相依，不應需要 `--force` 或
`--legacy-peer-deps`。

### 4. 安裝後端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
deactivate
cd ..
```

如果 PowerShell 阻止執行啟用腳本，可只對目前視窗暫時調整：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 5. Blender（只有 USDZ / iOS AR 需要）

Android Scene Viewer 主要使用 GLB，不要求 USDZ。
iOS Quick Look 則需要後端可呼叫 Blender headless 進行 GLB → USDZ 轉換。
請確認 Blender 已安裝，並依 `.env.example` / 後端設定提供可執行檔位置（若環境不是預設位置）。

## 服務與預設 Port

| 服務 | 預設位置 | 用途 |
|---|---|---|
| Vite 前端 | `http://127.0.0.1:5173` | 操作介面、GLB / AR Viewer |
| FastAPI 後端 | `http://127.0.0.1:8000` | 前端 API、OpenAI、ComfyUI、USDZ 轉換 |
| FastAPI 文件 | `http://127.0.0.1:8000/docs` | API 測試介面 |
| ComfyUI | `http://127.0.0.1:8188` | 執行圖片與 3D Workflow |
| Tailscale Serve | HTTPS `443` | 開發時讓手機安全連入 Vite |

## 啟動順序

建議分別開啟三個 PowerShell 視窗。

### 1. 啟動 ComfyUI

依自己的 ComfyUI 安裝方式啟動，並確認可以開啟：

```text
http://127.0.0.1:8188
```

### 2. 啟動 FastAPI 後端

從專案根目錄執行：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 3. 啟動 Vite 前端

從另一個專案根目錄視窗執行：

```powershell
cd frontend
npm run dev
```

## Tailscale Serve / Android AR 開發測試

這是目前的開發測試方式，不是正式 production deployment。

1. Windows 電腦與 Android 手機加入同一個 Tailnet。
2. 在根目錄 `.env` 設定自己的 HTTPS Host：

```dotenv
VITE_API_BASE_URL=
VITE_ALLOWED_HOSTS=your-device.your-tailnet.ts.net
```

清空 `VITE_API_BASE_URL` 後，前端使用同源 `/api`，由 Vite proxy 轉送至
`http://127.0.0.1:8000`，避免手機 HTTPS 頁面直接呼叫本機 HTTP API。

3. 確認 FastAPI、Vite 都已啟動後：

```powershell
tailscale status
tailscale serve --bg http://127.0.0.1:5173
tailscale serve status
```

4. 在手機 Chrome 開啟 Tailscale Serve 提供的 HTTPS 網址。
5. 進入具有 AR Viewer 的模型頁面，測試 Google Scene Viewer。

停止 Serve：

```powershell
tailscale serve --https=443 off
```

詳細交接請看：

- [Android AR 真機測試與 Tailscale Serve 設定](./development-log/kila606/2026-08-10-android-ar-tailscale-serve.md)

## 主要 API

### 健康狀態

- `GET /api/health`
- `GET /api/comfy/health`
- `GET /api/openai/health`

### 圖片

- `POST /api/images/upload`
- `POST /api/images/generate`
- `POST /api/images/{source_image_id}/edits`
- `GET /api/assets/images/{filename}`

### Video Frame Picker

- 路由：`/video-upload`
- 使用方式：從首頁左欄的 Video Frame Picker panel 進入，選擇本機影片後用時間軸挑選畫面，再按「加入此畫面」。
- 常見可選影片格式包含 MP4、MOV、WebM；實際播放能力取決於使用者瀏覽器與影片 codec。
- 影片本身只在瀏覽器本機播放，不進入後端，也不會整支上傳。
- 擷取出的單張影格會以 PNG 圖片沿用 `POST /api/images/upload` 進入 Asset Library。

### Single 3D Job

- `POST /api/3d/jobs`
- `GET /api/3d/jobs/{job_id}`
- `GET /api/3d/jobs/{job_id}/model`

### Multiview

- `POST /api/multiview/jobs`
- `GET /api/multiview/jobs/{job_id}`
- `POST /api/multiview/jobs/{job_id}/views/{view}/accept`
- `POST /api/multiview/jobs/{job_id}/views/{view}/regenerate`
- `POST /api/multiview/jobs/{job_id}/views/{view}/candidate`
- `POST /api/multiview/jobs/{job_id}/model-job`
- `GET /api/multiview/jobs/{job_id}/model-job`
- `GET /api/multiview/jobs/{job_id}/models/{kind}`

### Asset Library

- `GET /api/library/assets`
- `GET /api/library/assets/{asset_id}`
- `GET /api/library/assets/{asset_id}/content`
- `POST /api/library/assets/{asset_id}/trash`
- `POST /api/library/assets/{asset_id}/restore`
- `DELETE /api/library/assets/{asset_id}`

AR／USDZ 相關 endpoint 以目前 `jobs_3d.py`、`multiview.py` 與 `library.py` 實作為準；
Depth Anything V2／3 尚無正式 endpoint，不應列為已整合的平台功能。
進行部署或 API 串接前請先查看對應 route，避免只依文件猜 endpoint。

## 驗證方式

### 後端測試

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest
```

2026-08-04 的 main 基線驗證結果：

```text
155 passed, 1 skipped
```

其後 `main` 已新增 Blender／USDZ／AR 相關程式與測試；部署前請在目標機器重新跑一次完整 pytest。
不要把上述舊數字視為目前 `main` 的最新測試總數。

### 前端型別與正式建置

```powershell
cd frontend
npm run typecheck
npm run build
```

2026-08-05 基線兩項皆通過；其後 `main` 修改依賴與 Viewer，部署機器仍應重新執行。

## 停止服務

在各服務的 PowerShell 視窗按下 `Ctrl + C`。後端停止後可離開 Python
Virtual Environment：

```powershell
deactivate
```

## 開發限制提醒

- Job Store 與 Multiview Version History 目前在記憶體中，FastAPI 重啟後會消失。
- Asset Catalog 的 SQLite 資料庫只保存 Storage 資產與 metadata，不恢復 Job。
- 多 worker 不共享 Job 狀態。
- `storage/images/`、`storage/models/` 與 `storage/assets.db*` 不提交至 Git。
- `prototype-reference` 預設只供參考；只有使用者明確要求時才能修改。
- OpenAI 與 ComfyUI 的長時間生成仍需在部署環境額外驗證。
- Tailscale Serve 是開發用 HTTPS 存取方案，不代表正式部署架構。

## 開發紀錄

功能、API、架構或重要 Bug 有實質變更時，請在
[development-log/](./development-log/README.md) 留下紀錄。單純修改錯字或
小幅調整樣式，不需要另外建立一篇文件。
