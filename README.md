# 生成式 AI 可編輯 3D 資產平台

本專案目標是建立一套可產生、預覽、管理並逐步編輯 3D 資產的生成式 AI 平台。
目前已完成可操作的單圖與多視角 MVP：使用者可以生成或上傳參考圖，選擇單圖或
Front／Left／Back 多視角流程，建立 3D Job、預覽 GLB，並在資產庫管理產出的圖片與模型。

## 目前進度

### 已完成

- Vite + React + TypeScript 分階段工作區
  - Reference、Mode、Views、Generate、Inspect
  - URL 明確攜帶 Single／Multiview Job 身分
  - 切頁後持續輪詢進行中的 Job
  - Home 與 StageShell 共用五階段導覽規則
- OpenAI 圖片功能
  - 對話式圖片生成
  - 指定圖片修改，原圖與修改版本分開保存
  - Multiview 單一視角 GPT Image Edit
- 本機圖片上傳、Reference 選擇、隱藏／恢復與新對話
- Video Frame Picker
  - 從本機 MP4／MOV／WebM 等影片選擇時間點並擷取 Reference Image
  - 完整影片不會上傳；只有使用者選取的單張影格會進入 Asset Library
  - 成功擷取的影格可設為 Reference，沿用現有 Single／Multiview 流程
- Single Image → ComfyUI Hunyuan3D → GLB 流程
- Multiview Reference → Qwen Front／Left／Back → Hunyuan Multiview GLB 流程
- Multiview 單視角調整
  - 本機固定視角 Prompt 搭配新 Seed 重新抽選
  - GPT 指令調整，支援中文輸入
  - Candidate／Accept 流程與完整視角版本紀錄
- Asset Library
  - SQLite Asset Catalog 與啟動時檔案盤點
  - 圖片、Multiview 視圖與 GLB metadata
  - 搜尋、篩選、預覽、下載與設為 Reference
  - Trash、Restore、Permanent Delete 與引用安全檢查
- Three.js 模型檢查 Viewer
  - Original／Clay／Normal／Wireframe 模式
  - Grid／Axes、無陰影多方向補光
  - Mesh／Vertices／Triangles 統計
- Game UI 第一版
  - 首頁三區布局、orbital workspace 入口與暗色終端風格
  - 統一階段 Stepper、Recovery 畫面與主要操作對比
- GPL-3.0 授權與第三方來源標示

### 尚未完成

- Job、Multiview 工作階段與視角版本紀錄的跨重啟持久化
- 多 worker 共用 Job 狀態與正式任務佇列
- Mesh 部件拆分、材質編輯、拓樸檢查與骨架／IK
- 完整逐頁 UI QA、RWD 細節與正式視覺 polish
- 正式環境部署與長時間生成穩定性驗證

## 最近驗證

2026-08-04：

- 後端完整測試：`155 passed, 1 skipped`
- 人工驗證：
  - Single 與 Multiview 完整生成流程
  - 本機單視角重新抽選與 GPT 單視角修改
  - Candidate 接受、歷史版本切換與回復
  - Asset Library Trash／Restore／Permanent Delete

2026-08-05：

- 前端：`npm run typecheck` 與 `npm run build` 通過
  - Vite build 仍有既有 chunk size warning
- 程式檢查：
  - Game UI 導覽規則、Recovery stepper 與 Lightbox Set Candidate 錯誤顯示的程式檢查
- Video Frame Picker 整合：
  - `npm run typecheck` 與 `npm run build` 通過
  - 影片僅於瀏覽器本機播放，擷取影格沿用 `POST /api/images/upload`

## 專案目錄

```text
3D-Asset-Platform/
├─ frontend/             # React staged workspace and Three.js GLB viewer
├─ backend/              # FastAPI API, job services and asset catalog
├─ workflows/            # ComfyUI API workflows
├─ storage/              # Runtime images, models and SQLite catalog (not tracked)
├─ prototype-reference/  # Original UI reference
└─ docs/                 # Setup guides and development logs
```

## 文件入口

完整的環境版本、團隊安裝方式、啟動順序、服務 Port 與停止方式，請先閱讀：

- [專案文件與安裝指南](./docs/README.md)
- [團隊開發紀錄](./docs/development-log/README.md)
- [Shafuing 開發紀錄](./docs/development-log/shafuing/README.md)

修改程式前，請先查看負責範圍對應的最新開發紀錄，以及根目錄的
[AGENTS.md](./AGENTS.md)。

## 重要限制

- Job Store 與 Multiview Version History 目前保存在記憶體，FastAPI 重啟後不會恢復。
- Asset Catalog 只持久化 `storage/` 中的圖片、模型與 metadata，不等同 Job persistence。
- OpenAI API Key 只能放在後端環境設定，前端不得保存金鑰。
- ComfyUI 預設由 FastAPI 後端呼叫，不由瀏覽器直接連線。

## 授權

本專案採用 [GNU General Public License v3.0](./LICENSE) 授權。
第三方來源與修改說明請見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
