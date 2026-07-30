# FastAPI 後端生成 API MVP

- 日期：2026-07-30
- 負責人：ShaFuIng
- 分支：`feat/backend-generation-api`
- 相關 Commit：尚未提交

## 完成項目

- 新增圖片上傳、圖片取得與 OpenAI 對話式圖片生成 API。
- 新增 3D 生成 Job API、Job 狀態查詢與完成 GLB 取得 API。
- 新增統一錯誤格式。
- 新增正式 `workflows/hunyuan3d_api.json`，未修改 `prototype-reference`。
- 新增不呼叫真實 OpenAI 或 ComfyUI 的後端測試。

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

OpenAI 使用官方 Python SDK 的 `AsyncOpenAI`，透過 Responses API 加上
`image_generation` tool 產生圖片。測試以 mock client 驗證，不執行付費 API。

ComfyUI 呼叫集中在 `services/comfy_client.py`，背景 Job 會上傳圖片、提交
Hunyuan3D workflow、輪詢 history、下載 GLB 並存入 `storage/models/`。

## Job Store 限制

目前使用 in-memory Job Store，只適合開發階段：

- FastAPI 重啟後 Job 消失。
- 多 worker 不共享狀態。
- 尚未加入資料庫、Redis、Celery 或其他持久化系統。

## 尚未完成

- 尚未進行 React 前端串接。
- 尚未執行真實 OpenAI 付費整合測試。
- 尚未執行真實長時間 ComfyUI / Hunyuan3D 生成測試。

