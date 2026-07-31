# 專案文件與團隊安裝指南

本文件是 `3D-Asset-Platform` 的主要技術文件入口。新加入的組員或接手
專案的 AI，應先閱讀本頁，再依負責範圍查看對應的開發紀錄。

## 文件導航

| 文件 | 用途 |
|---|---|
| [根目錄 README](../README.md) | 專案目標、MVP 進度與待辦 |
| [AGENTS.md](../AGENTS.md) | 開發限制與協作規則 |
| [開發紀錄說明](./development-log/README.md) | 紀錄命名、撰寫時機與格式 |
| [Shafuing 開發紀錄](./development-log/shafuing/README.md) | 圖片生成、3D Job、Viewer 與目前交接狀態 |

## 目前階段

目前已完成可操作的單圖轉 3D MVP：

- Vite + React + TypeScript 對話式前端
- OpenAI 圖片生成與多輪圖片修改
- 本機圖片上傳、圖片選擇與圖庫
- FastAPI 圖片與 3D 生成 API
- ComfyUI Hunyuan3D Workflow 提交
- 3D Job 建立、狀態輪詢與錯誤顯示
- GLB 儲存、下載與 Three.js 載入
- Original／Clay／Normal／Wireframe 模型檢查模式
- Grid／Axes、模型統計、相機重設與無陰影多方向補光
- 三視圖工作區 UI 骨架

目前尚未完成：

- 真正的前／側／後三視圖生成
- Job、生成歷史與模型版本持久化
- Mesh 拆分、編輯、拓樸處理與骨架／IK
- 多 worker 共用狀態與正式任務佇列
- 正式環境的長時間生成與部署驗證

## 環境與版本

### 執行環境

| 工具 | 建議或已驗證版本 |
|---|---|
| Node.js | 建議 Node.js 22 LTS；Vite 8 至少需要 `^20.19.0` 或 `>=22.12.0` |
| npm | 使用 Node.js 隨附版本，並由 `package-lock.json` 鎖定依賴 |
| Python | 本次合併驗證使用 Python `3.10.11` |
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

`.env` 僅供本機使用，不可 Commit。範例內容為：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
COMFYUI_BASE_URL=http://127.0.0.1:8188
OPENAI_API_KEY=
OPENAI_RESPONSE_MODEL=gpt-5.6
```

- `OPENAI_API_KEY` 只能放在後端環境，不可寫入前端。
- FastAPI 會讀取根目錄 `.env`。
- `frontend/vite.config.ts` 已設定 `envDir: '..'`，Vite 也會讀取根目錄
  `.env`，一般情況不必另外在 PowerShell 重複設定。

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
| FastAPI 後端 | `http://127.0.0.1:8000` | 前端 API 與 ComfyUI 代理 |
| FastAPI 文件 | `http://127.0.0.1:8000/docs` | API 測試介面 |
| ComfyUI | `http://127.0.0.1:8188` | 執行 3D Workflow |

## 啟動順序

建議分別開啟三個 PowerShell 視窗。

### 1. 啟動 ComfyUI

依自己的 ComfyUI 安裝方式啟動，並確認可以開啟：

```text
http://127.0.0.1:8188
```

ComfyUI 尚未啟動時，FastAPI 不會崩潰；`GET /api/comfy/health`
會回傳 `disconnected`。

### 2. 啟動 FastAPI 後端

從專案根目錄執行：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
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
- `GET /api/assets/images/{filename}`

### 3D Job

- `POST /api/3d/jobs`
- `GET /api/3d/jobs/{job_id}`
- `GET /api/3d/jobs/{job_id}/model`

## 驗證方式

### 後端測試

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest
```

2026-07-31 合併至 `main` 後的結果：

```text
39 passed in 0.52s
```

### 前端型別與正式建置

```powershell
cd frontend
npm run typecheck
npm run build
```

前端建置、瀏覽器操作與生成 GLB 顯示已於 2026-07-31 在本機驗證正常。

## 停止服務

在各服務的 PowerShell 視窗按下 `Ctrl + C`。後端停止後可離開 Python
Virtual Environment：

```powershell
deactivate
```

## 開發限制提醒

- Job Store 目前在記憶體中，FastAPI 重啟後 Job 會消失。
- 多 worker 不共享 Job 狀態。
- `storage/images/` 與 `storage/models/` 的生成內容不提交至 Git。
- `prototype-reference` 預設只供參考；只有使用者明確要求時才能修改。

## 開發紀錄

功能、API、架構或重要 Bug 有實質變更時，請在
[development-log/](./development-log/README.md) 留下紀錄。單純修改錯字或
小幅調整樣式，不需要另外建立一篇文件。
