# 建立第一階段專案骨架

- 日期：2026-07-29
- 負責人：ShaFuIng
- 分支：`main`
- 相關 Commit：初始骨架 `f393df1`；文件與 GLB 空白狀態尚未提交

## 本次目標

建立可供團隊共同開發的前端、後端與 ComfyUI 連線檢查骨架，並補上團隊
安裝和開發紀錄文件。

## 完成內容

- 建立 Vite + React + TypeScript 前端。
- 加入 `@google/model-viewer` GLB 預覽元件。
- 建立 FastAPI 後端。
- 加入 `GET /api/health`。
- 加入 `GET /api/comfy/health`。
- ComfyUI 未啟動時回傳 `disconnected`，不讓後端崩潰。
- 將不存在的 `/sample.glb` 改為正常的空白預覽狀態。
- 建立 `docs/development-log` 團隊開發紀錄架構。

## 主要修改檔案

- `frontend/src/App.tsx`
- `frontend/src/components/ModelViewer.tsx`
- `backend/app/main.py`
- `README.md`
- `docs/README.md`
- `docs/development-log/`

## 設計與實作說明

前端只呼叫 FastAPI，不直接呼叫 ComfyUI。FastAPI 從環境變數
`COMFYUI_BASE_URL` 取得 ComfyUI 位址，並以 HTTP 健康檢查確認服務狀態。

Repository 不放測試 GLB，因此前端沒有模型 URL 時顯示 Placeholder。等後端能
回傳真正的生成結果後，再將該 URL 傳入 `ModelViewer`。

## 驗證方式與結果

前端：

```powershell
cd frontend
npm run typecheck
npm run build
```

後端：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

結果：初始骨架曾完成前端建置與後端健康檢查。本次文件與 GLB 空白狀態
修改已通過 Git diff 格式檢查；目前 Work Mode 環境因 npm 套件下載／快取
錯誤，未能重新完成 `npm ci`，需在本機再次執行前端驗證指令。

## 已知問題

- 尚未提交真正的 ComfyUI Workflow。
- 尚未建立非同步任務狀態與 `prompt_id` 管理。
- 尚未將生成 GLB 的 URL 傳回前端。
- 尚未建立自動化測試或 GitHub Actions。

## 下一步

- 定義 ComfyUI Workflow API 輸入與輸出格式。
- 建立 Workflow 提交與任務查詢 API。
- 將完成的 GLB 結果接入前端預覽元件。
