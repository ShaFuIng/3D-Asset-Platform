# Shafuing 開發紀錄

## 目前負責範圍

- 專案架構與團隊文件
- Vite + React + TypeScript 前端
- FastAPI 圖片與 3D 生成 API
- OpenAI 圖片生成與多輪修改
- ComfyUI Hunyuan3D Workflow 串接
- Three.js GLB 模型檢查 Viewer
- 三視圖工作區規劃與 UI 骨架

## 紀錄索引

- [2026-07-29：初始前後端骨架](./2026-07-29-initial-scaffold.md)
- [2026-07-30：FastAPI 後端生成 API MVP](./2026-07-30-backend-generation-api.md)
- [2026-07-31：Model Viewer Inspection](./2026-07-31-model-viewer-inspection.md)
- [2026-07-31：單圖轉 3D MVP 整合與驗證](./2026-07-31-mvp-integration.md)

## 目前交接重點

- 單圖流程已可完成圖片生成／上傳、圖片選擇、3D Job、狀態輪詢與 GLB 載入。
- 圖片生成支援對話式多輪修改，API Key 只保存在後端環境設定。
- Three.js Viewer 已提供材質模式、格線、座標軸、模型統計與無陰影多方向補光。
- 三視圖頁面目前是 UI 與流程入口骨架，尚未完成真正的前／側／後視圖生成。
- Job Store 仍位於記憶體；FastAPI 重啟或多 worker 執行時不會共享狀態。
- 2026-07-31 合併後，後端測試為 `39 passed`，前端建置與瀏覽器 GLB 顯示已驗證正常。
