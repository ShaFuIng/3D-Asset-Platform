# Shafuing 開發紀錄

## 目前負責範圍

- 專案架構與團隊文件
- Vite + React + TypeScript 分階段前端
- FastAPI 圖片、Single 3D、Multiview 與 Asset Library API
- OpenAI 圖片生成、指定圖片修改與 Multiview GPT Edit
- ComfyUI Qwen Multiview 與 Hunyuan3D Workflow 串接
- SQLite Asset Catalog、Trash／Restore／Permanent Delete
- Three.js GLB 模型檢查 Viewer
- Game UI、五階段導覽與前端操作體驗整理

## 紀錄索引

- [2026-07-29：初始前後端骨架](./2026-07-29-initial-scaffold.md)
- [2026-07-30：FastAPI 後端生成 API MVP](./2026-07-30-backend-generation-api.md)
- [2026-07-31：Model Viewer Inspection](./2026-07-31-model-viewer-inspection.md)
- [2026-07-31：單圖轉 3D MVP 整合與驗證](./2026-07-31-mvp-integration.md)
- [2026-08-04：Asset Library 與 Multiview Guided Regeneration](./2026-08-04-asset-library-and-multiview-regeneration.md)
- [2026-08-05：Game UI Redesign 與階段導覽整理](./2026-08-05-game-ui-redesign.md)
- [2026-08-05：Video Frame Picker 整合](./2026-08-05-video-frame-picker-integration.md)

## 目前交接重點

- Single 流程已完成 Reference、3D Job、輪詢、GLB 檢視與下載。
- Multiview 已可生成 Front／Left／Back、逐張接受，再建立 Geometry／Textured GLB。
- 單一視角支援本機新 Seed 重新抽選與 GPT Image Edit，兩者都先產生 Candidate。
- Multiview Lightbox 可瀏覽 Initial／Local Reroll／GPT Edit 歷史版本，設定 Candidate 後仍需明確 Accept。
- Asset Library 會盤點 `storage/images` 與 `storage/models`，支援預覽、下載、Trash、Restore 與安全永久刪除。
- 前端已加入第一版 Game UI：首頁三區布局、orbital workspace 入口、暗色終端風格、統一五階段導覽與 recovery stepper opt-out。
- Video Frame Picker 已整合進 Game UI 首頁左欄獨立 panel 與 `/video-upload` route；原始功能由 kila606 在 `feat/video-frame-picker` 開發。
- `frontend/src/navigation/stageNav.ts` 是 Home 與 StageShell 共用的階段導覽規則來源，修改導覽前需先檢查此檔。
- Job Store 與 Multiview Version History 仍位於記憶體；FastAPI 重啟後不恢復。
- Asset Catalog 使用 SQLite 保存資產 metadata，但不等同 Job persistence。
- 2026-08-04 後端完整測試為 `155 passed, 1 skipped`。
- 2026-08-05 前端 `npm run typecheck` 與 `npm run build` 通過；build 仍有既有 chunk size warning。
- 下一階段主要是完整人工 UI QA、正式 RWD 細節、長時間生成穩定性驗證與 Job persistence 設計。
