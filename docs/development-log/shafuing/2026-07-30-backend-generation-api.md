# FastAPI 後端生成 API MVP

- 日期：2026-07-30
- 負責人：ShaFuIng
- 分支：`feat/backend-generation-api`
- 主要 Commit：`7dc8748`、`512d936`
- 後續整合 Commit：`677bc91`、`f7b9c67`、`7171021`

## 完成項目

- 新增圖片上傳、圖片取得與 OpenAI 對話式圖片生成 API。
- 支援多輪圖片修改與 assistant response message 序列化。
- 新增 3D 生成 Job API、Job 狀態查詢與完成 GLB 取得 API。
- 新增統一錯誤格式與 OpenAI 請求錯誤紀錄。
- 新增正式 `workflows/hunyuan3d_api.json`。
- 新增不呼叫真實 OpenAI 或 ComfyUI 的後端測試。
- 已完成 React 前端串接。

## API Endpoint

- `GET /api/health`
- `GET /api/comfy/health`
- `GET /api/openai/health`
- `POST /api/images/upload`
- `POST /api/images/generate`
- `GET /api/assets/images/{filename}`
- `POST /api/3d/jobs`
- `GET /api/3d/jobs/{job_id}`
- `GET /api/3d/jobs/{job_id}/model`

## OpenAI 與 ComfyUI

OpenAI 使用官方 Python SDK 的 `AsyncOpenAI`，透過 Responses API 與
`image_generation` tool 產生圖片。自動測試使用 mock client，不執行付費 API。

ComfyUI 呼叫集中在 `services/comfy_client.py`。背景 Job 會上傳圖片、提交
Hunyuan3D Workflow、輪詢 history、下載 GLB 並存入 `storage/models/`。

## Job Store 限制

目前使用 in-memory Job Store，只適合開發階段：

- FastAPI 重啟後 Job 消失。
- 多 worker 不共享狀態。
- 尚未加入資料庫、Redis、Celery 或其他持久化系統。
- 尚未保存生成歷史與模型版本。

## 驗證狀態

2026-07-31 合併至 `main` 後：

- 後端完整測試套件：`39 passed in 0.52s`
- React 前端已可建立與輪詢 3D Job。
- 本機瀏覽器已驗證生成 GLB 可正常載入 Three.js Viewer。

## 尚待驗證與後續工作

- 真實 OpenAI 付費整合仍需依有效 API Key 與用量另行驗證。
- ComfyUI／Hunyuan3D 的長時間連續生成穩定性尚未完整測試。
- 正式部署前需導入持久化 Job Store 與任務佇列。
