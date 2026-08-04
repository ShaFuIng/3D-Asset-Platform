# Shafuing 開發紀錄

## 目前負責範圍

- 專案架構與團隊文件
- Vite + React + TypeScript 分階段前端
- FastAPI 圖片、Single 3D、Multiview 與 Asset Library API
- OpenAI 圖片生成、指定圖片修改與 Multiview GPT Edit
- ComfyUI Qwen Multiview 與 Hunyuan3D Workflow 串接
- SQLite Asset Catalog、Trash／Restore／Permanent Delete
- Three.js GLB 模型檢查 Viewer

## 紀錄索引

- [2026-07-29：初始前後端骨架](./2026-07-29-initial-scaffold.md)
- [2026-07-30：FastAPI 後端生成 API MVP](./2026-07-30-backend-generation-api.md)
- [2026-07-31：Model Viewer Inspection](./2026-07-31-model-viewer-inspection.md)
- [2026-07-31：單圖轉 3D MVP 整合與驗證](./2026-07-31-mvp-integration.md)
- [2026-08-04：Asset Library 與 Multiview Guided Regeneration](./2026-08-04-asset-library-and-multiview-regeneration.md)

## 目前交接重點

- Single 流程已完成 Reference、3D Job、輪詢、GLB 檢視與下載。
- Multiview 已可生成 Front／Left／Back、逐張接受，再建立 Geometry／Textured GLB。
- 單一視角支援本機新 Seed 重新抽選與 GPT Image Edit，兩者都先產生 Candidate。
- Multiview Lightbox 可瀏覽 Initial／Local Reroll／GPT Edit 歷史版本，設定 Candidate 後仍需明確 Accept。
- Asset Library 會盤點 `storage/images` 與 `storage/models`，支援預覽、下載、Trash、Restore 與安全永久刪除。
- Job Store 與 Multiview Version History 仍位於記憶體；FastAPI 重啟後不恢復。
- Asset Catalog 使用 SQLite 保存資產 metadata，但不等同 Job persistence。
- 2026-08-04 後端完整測試為 `155 passed, 1 skipped`；前端 typecheck/build 與人工流程驗證通過。
- 下一階段主要是完整遊戲風格 UI、互動動畫，以及更長時間的生成穩定性驗證。
