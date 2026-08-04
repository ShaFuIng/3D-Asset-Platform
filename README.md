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
- OpenAI 圖片功能
  - 對話式圖片生成
  - 指定圖片修改，原圖與修改版本分開保存
  - Multiview 單一視角 GPT Image Edit
- 本機圖片上傳、Reference 選擇、隱藏／恢復與新對話
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
- GPL-3.0 授權與第三方來源標示

### 尚未完成

- Job、Multiview 工作階段與視角版本紀錄的跨重啟持久化
- 多 worker 共用 Job 狀態與正式任務佇列
- Mesh 部件拆分、材質編輯、拓樸檢查與骨架／IK
- 完整的遊戲風格 UI、動畫與正式 RWD 視覺設計
- 正式環境部署與長時間生成穩定性驗證

## 最近驗證

2026-08-04：

- 後端完整測試：`155 passed, 1 skipped`
- 前端：`npm run typecheck` 與 `npm run build` 通過
- 人工驗證：
  - Single 與 Multiview 完整生成流程
  - 本機單視角重新抽選與 GPT 單視角修改
  - Candidate 接受、歷史版本切換與回復
  - Asset Library Trash／Restore／Permanent Delete

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
