# 生成式 AI 可編輯 3D 資產平台

第一階段目標是建立 Vite + React + TypeScript 前端、FastAPI 後端，以及本機 ComfyUI API 連線檢查。

## 預設服務 Port

- Frontend Vite: `http://localhost:5173`
- Backend FastAPI: `http://127.0.0.1:8000`
- ComfyUI: `http://127.0.0.1:8188`

## 安裝方式

Windows PowerShell：

```powershell
cd D:\生成式AI專題競賽\3D-Asset-Platform

cd frontend
npm install

cd ..\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 後端啟動方式

```powershell
cd D:\生成式AI專題競賽\3D-Asset-Platform\backend
.\.venv\Scripts\Activate.ps1
$env:COMFYUI_BASE_URL = "http://127.0.0.1:8188"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

健康檢查：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/comfy/health
```

## 前端啟動方式

```powershell
cd D:\生成式AI專題競賽\3D-Asset-Platform\frontend
$env:VITE_API_BASE_URL = "http://127.0.0.1:8000"
npm run dev
```

## ComfyUI 啟動順序

1. 先啟動 ComfyUI，確認服務在 `http://127.0.0.1:8188`。
2. 啟動 FastAPI 後端。
3. 啟動 Vite 前端。

若 ComfyUI 尚未啟動，`GET /api/comfy/health` 會回傳 `disconnected`，後端不會崩潰。

## 如何停止服務

在各服務的 PowerShell 視窗按 `Ctrl + C`。若已啟用 Python virtual environment，可執行：

```powershell
deactivate
```

