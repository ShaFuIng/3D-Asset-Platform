# 2026-07-31 Model Viewer Inspection

## 範圍

在 `feat/model-viewer-inspection` 改善 Three.js GLB 預覽，核心目標是讓
模型從不同方向觀看時保持清楚，並提供 Mesh 檢查工具。

## 完成項目

- 將單一固定方向光改為環境光與前、後、左、右、下方補光。
- 明確關閉 Renderer 與 Mesh 陰影。
- 新增地面格線（Grid）與座標軸（Axes）。
- 新增 Original、Clay、Normal 與 Wireframe 材質模式。
- 新增 Mesh、Vertices 與 Triangles 統計。
- 新增 Grid、自動旋轉與相機重設控制。
- 模型載入後先放置於地面格線，再自動計算相機視角。
- 新增 GPL-3.0 授權與 ComfyUI Frontend 來源標示。

## 相關 Commit

- `f5b4b32`：新增模型檢查 Viewer。
- `bc2c1d1`：同步 GPL 授權 metadata。
- `52d3ffc`：合併功能分支至 `main`。

## 驗證

- TypeScript 型別檢查通過。
- 2026-07-31 已在本機瀏覽器使用生成 GLB 驗證顯示、旋轉、材質模式與統計功能。
- 合併後後端完整測試套件通過：`39 passed in 0.52s`。

## 授權

Viewer 的部分實作衍生自 ComfyUI Frontend。專案採 GPL-3.0，
來源與修改說明記錄於根目錄 `THIRD_PARTY_NOTICES.md`。
Three.js 本身採 MIT License。
