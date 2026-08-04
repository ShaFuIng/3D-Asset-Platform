# 專案文件與團隊安裝指南

本文件是 `3D-Asset-Platform` 的主要技術文件入口。新加入的組員或接手
專案的 AI，應先閱讀本頁，再依負責範圍查看對應的開發紀錄。

## 文件導航

| 文件 | 用途 |
|---|---|
| [根目錄 README](../README.md) | 專案目標、MVP 進度與待辦 |
| [AGENTS.md](../AGENTS.md) | 開發限制與協作規則 |
| [開發紀錄說明](./development-log/README.md) | 紀錄命名、撰寫時機與格式 |
| [Shafuing 開發紀錄](./development-log/shafuing/README.md) | 圖片、3D、Multiview、Asset Library 與交接狀態 |

## 目前階段

目前已完成可操作的單圖與多視角 3D MVP：

- Vite + React + TypeScript 分階段前端
- OpenAI 圖片生成、指定圖片修改與 Multiview GPT Edit
- 本機圖片上傳、Reference 選擇、隱藏／恢復
- Single Image 3D Job、輪詢、GLB 預覽與下載
- Qwen Front／Left／Back 三視圖生成與 Hunyuan Multiview 3D
- 單一視角本機重新抽選、GPT 修改、Candidate 接受與版本歷史
- SQLite Asset Catalog 與 Asset Library
- 圖片／模型搜尋、篩選、預覽、下載、Trash、Restore、Permanent Delete
- Three.js Original／Clay／Normal／Wireframe 模型檢查
- Grid／Axes、模型統計、相機重設與無陰影多方向補光

目前尚未完成：

- Job、Multiview 工作階段與版本歷史的跨重啟持久化
- Mesh 拆分、材質編輯、拓樸處理與骨架／IK
- 多 worker 共用狀態與正式任務佇列
- 完整遊戲風格 UI 與動畫
- 正式環境的長時間生成與部署驗證

## 環境與版本

### 執行環境

| 工具 | 建議或已驗證版本 |
|---|---|
| Node.js | 建議 Node.js 22 LTS；Vite 8 至少需要 `^20.19.0` 或 `>=22.12.0` |
| npm | 使用 Node.js 隨附版本，並由 `package-lock.json` 鎖定依賴 |
| Python | 已驗證 Python `3.10.11`；開發者亦可依目前 requirements 建立相容環境 |
| ComfyUI | 本機 API 預設為 `http://127.0.0.1:8188` |

### 前端主要套件

宣告範圍以 `frontend/package.json` 為準，實際安裝版本由
`frontend/package-lock.json` 鎖定：

| 套件 | 宣告版本 |
|---|---|
| React | `^19.1.0` |
| React DOM | `^19.1.0` |
| React Router DOM | `^7.18.2` |
| Three.js | `^0.185.1` |
| TypeScript | `^5.8.3` |
| Vite | `^8.1.5` |
| `@vitejs/plugin-react` | `^6.0.4` |

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

### 2. 建立本機環境設定

```powershell
Copy-Item .env.example .env
```

範例內容：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
COMFYUI_BASE_URL=http://127.0.0.1:8188
OPENAI_API_KEY=
OPENAI_RESPONSE_MODEL=gpt-5.6
```

- `.env` 僅供本機使用，不可 Commit。
- `OPENAI_API_KEY` 只能放在後端環境，不可寫入前端。
- FastAPI 會讀取根目錄 `.env`。
- `frontend/vite.config.ts` 使用根目錄環境設定。

### 3. 安裝前端

```powershell
cd frontend
npm ci
cd ..
```

團隊安裝建議使用 `npm ci`，確保依照 `package-lock.json` 安裝相同版本。
只有需要更新依賴時才使用 `npm install`。

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

## 服務與預設 Port

| 服務 | 預設位置 | 用途 |
|---|---|---|
| Vite 前端 | `http://127.0.0.1:5173` | 操作介面與 GLB 預覽 |
| FastAPI 後端 | `http://127.0.0.1:8000` | 前端 API、OpenAI 與 ComfyUI 代理 |
| FastAPI 文件 | `http://127.0.0.1:8000/docs` | API 測試介面 |
| ComfyUI | `http://127.0.0.1:8188` | 執行圖片與 3D Workflow |

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

## 驗證方式

### 後端測試

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest
```

2026-08-04 驗證結果：

```text
155 passed, 1 skipped
```

### 前端型別與正式建置

```powershell
cd frontend
npm run typecheck
npm run build
```

2026-08-04 兩項皆通過。Vite 仍會提示既有 chunk size warning，不影響建置完成。

### 人工驗證

已驗證：

- Single 與 Multiview 完整生成流程
- 本機單視角重新抽選與 GPT 單視角修改
- Candidate 接受、歷史版本瀏覽與回復
- Asset Library Trash／Restore／Permanent Delete
- Reference、Asset Library 與 Multiview Lightbox 的功能隔離

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

## 開發紀錄

功能、API、架構或重要 Bug 有實質變更時，請在
[development-log/](./development-log/README.md) 留下紀錄。單純修改錯字或
小幅調整樣式，不需要另外建立一篇文件。
