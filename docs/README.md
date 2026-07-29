# 專案文件與團隊安裝指南

本文件是 `3D-Asset-Platform` 的主要技術文件入口。新加入的組員或接手
專案的 AI，應先閱讀本頁，再依負責範圍查看對應的開發紀錄。

## 文件導航

| 文件 | 用途 |
|---|---|
| [根目錄 README](../README.md) | 專案目標、目錄與文件入口 |
| [AGENTS.md](../AGENTS.md) | 開發限制與協作規則 |
| [開發紀錄說明](./development-log/README.md) | 紀錄命名、撰寫時機與格式 |
| [Shafuing 開發紀錄](./development-log/shafuing/README.md) | 初始前後端骨架與目前進度 |

## 目前階段

第一階段已完成：

- Vite + React + TypeScript 前端
- `@google/model-viewer` GLB 預覽元件
- FastAPI 最小後端
- `GET /api/health`
- `GET /api/comfy/health`
- ComfyUI 無法連線時的可理解錯誤狀態

目前尚未完成：

- ComfyUI Workflow 提交與任務進度追蹤
- 生成結果的儲存與 GLB URL 回傳
- 真正的 GLB 模型載入流程

因此 GLB 預覽區目前會顯示空白提示，而不會要求不存在的
`/sample.glb`。

## 環境與版本

### 執行環境

| 工具 | 團隊建議 | 本次偵測版本 |
|---|---|---|
| Node.js | Node.js 22 LTS；至少符合 `^20.19.0` 或 `>=22.12.0` | `24.14.0` |
| npm | 使用 Node.js 隨附版本，並以 `package-lock.json` 鎖定依賴 | `11.9.0` |
| Python | Python 3.12 | `3.12.13` |
| ComfyUI | 可提供本機 API 的版本 | 尚未納入 Repository |

### 主要套件

前端宣告範圍以 `frontend/package.json` 為準；團隊實際安裝版本由
`frontend/package-lock.json` 鎖定：

| 套件 | 版本 |
|---|---|
| React | `19.2.8` |
| React DOM | `19.2.8` |
| TypeScript | `5.9.3` |
| Vite | `8.1.5` |
| `@vitejs/plugin-react` | `6.0.4` |
| `@google/model-viewer` | `4.3.1` |

後端版本以 `backend/requirements.txt` 為準：

| 套件 | 版本 |
|---|---|
| FastAPI | `0.116.1` |
| Uvicorn | `0.35.0` |
| HTTPX | `0.28.1` |
| python-dotenv | `1.1.1` |

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

`.env` 僅供本機使用，不可 Commit。預設內容為：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
COMFYUI_BASE_URL=http://127.0.0.1:8188
```

FastAPI 會讀取根目錄 `.env`。目前 Vite 啟動時仍由 PowerShell 設定
`VITE_API_BASE_URL`。

### 3. 安裝前端

```powershell
cd frontend
npm ci
cd ..
```

團隊安裝建議使用 `npm ci`，確保依照 `package-lock.json` 安裝相同版本。
只有在需要更新依賴時才使用 `npm install`。

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
| Vite 前端 | `http://localhost:5173` | 操作介面與 GLB 預覽 |
| FastAPI 後端 | `http://127.0.0.1:8000` | 前端 API 與 ComfyUI 代理 |
| FastAPI 文件 | `http://127.0.0.1:8000/docs` | API 測試介面 |
| ComfyUI | `http://127.0.0.1:8188` | 執行圖片與 3D Workflow |

## 啟動順序

建議分別開啟三個 PowerShell 視窗。

### 1. 啟動 ComfyUI

先依自己的 ComfyUI 安裝方式啟動服務，並確認可以開啟：

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
$env:COMFYUI_BASE_URL = "http://127.0.0.1:8188"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 3. 啟動 Vite 前端

從另一個專案根目錄視窗執行：

```powershell
cd frontend
$env:VITE_API_BASE_URL = "http://127.0.0.1:8000"
npm run dev
```

## 驗證方式

### 後端健康檢查

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/comfy/health
```

### 前端型別與建置檢查

```powershell
cd frontend
npm run typecheck
npm run build
```

## 停止服務

在各服務的 PowerShell 視窗按下 `Ctrl + C`。後端停止後可離開 Python
Virtual Environment：

```powershell
deactivate
```

## 開發紀錄

功能、API、架構或重要 Bug 有實質變更時，請在
[`development-log/`](./development-log/README.md) 留下紀錄。單純修改錯字
或小幅調整樣式，不需要另外建立一篇文件。
