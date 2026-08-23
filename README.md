# 生成式 AI 多視角可編輯 3D 資產製作管理平台

本專案目標是建立一套可產生、預覽、管理並逐步編輯 3D 資產的生成式 AI 平台。
目前已完成可操作的單圖與多視角 MVP：使用者可以生成或上傳參考圖，選擇單圖或
Front／Left／Back 多視角流程，建立 3D Job、預覽 GLB，並在資產庫管理產出的圖片與模型。
目前 `main` 已包含 Web AR 預覽、Android Scene Viewer、iOS Quick Look／USDZ
轉換流程，以及透過 Tailscale Serve 進行 HTTPS 真機測試的開發路徑。

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
- Web 3D / AR Viewer
  - `@google/model-viewer` 顯示 GLB
  - Android 使用 Google Scene Viewer AR 路徑
  - iOS 使用 Quick Look，後端可按需將 GLB 轉換並快取為 USDZ
  - Viewer、Job 與 Asset Library 頁面整合 AR loading／錯誤狀態
- Blender GLB → USDZ 轉換服務
  - FastAPI 後端呼叫 Blender headless script
  - 轉檔結果快取，避免重複產生相同 USDZ
- Tailscale Serve 開發測試路徑
  - Vite `/api` 同源 proxy 到 FastAPI
  - `VITE_ALLOWED_HOSTS` 支援開發者自己的 Tailnet HTTPS Host
  - Android 真機可透過 Tailscale Serve HTTPS 連入本機開發站台
- Three.js 模型檢查 Viewer
  - Original／Clay／Normal／Wireframe 模式
  - Grid／Axes、無陰影多方向補光
  - Mesh／Vertices／Triangles 統計
- Game UI 第一版
  - 首頁三區布局、orbital workspace 入口與暗色終端風格
  - 統一階段 Stepper、Recovery 畫面與主要操作對比
- GPL-3.0 授權與第三方來源標示

### 尚未完成／待驗證

- Job、Multiview 工作階段與視角版本紀錄的跨重啟持久化
- 多 worker 共用 Job 狀態與正式任務佇列
- 模型真實尺寸 metadata、GLB 尺度校正、AR 固定比例與尺寸驗證
- Depth Anything 場景重建、尺度校正與桌面端虛擬擺放仍屬研究方向，尚未整合進平台
- Mesh 部件拆分、材質編輯、拓樸檢查與骨架／IK
- 完整逐頁 UI QA、RWD 細節與正式視覺 polish
- 正式環境部署與長時間生成穩定性驗證
- Android Google Scene Viewer 的完整模型放置流程仍需持續真機驗證
- iOS Quick Look／USDZ 流程仍需在實際 iOS 裝置進行完整驗證

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

2026-08-08 ～ 2026-08-10：

- 加入 `@google/model-viewer` Web AR Viewer
- 建立 Blender headless GLB → USDZ 轉換與 FastAPI 串接
- Job、Viewer 與 Asset Library 加入 USDZ／AR 操作入口與狀態顯示
- 修正 `@google/model-viewer` peer dependency，相依版本固定為 `three@0.183.2`
- 建立 Vite same-origin `/api` proxy 與 `VITE_ALLOWED_HOSTS`
- 驗證 Tailscale Serve HTTPS 可連入 Vite，並可由 Vite proxy 存取本機 FastAPI

2026-08-23：

- 文件盤點確認 `main` 與 `kila606/ar-model-viewer` 指向相同提交，AR／USDZ／Tailscale Serve 已在 `main`。
- 本次僅更新文件狀態，未重新執行測試；上述 2026-08-04 與 2026-08-05 數字仍是最近一次有紀錄的完整驗證基線。

## 專案目錄

```text
3D-Asset-Platform/
├─ frontend/             # React workspace, model-viewer and Three.js viewer
├─ backend/              # FastAPI API, jobs, asset catalog and Blender client
├─ blender_scripts/      # Headless Blender conversion scripts
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
- [kila606 開發紀錄](./docs/development-log/kila606/README.md)
- [Android AR 與 Tailscale Serve 交接](./docs/development-log/kila606/2026-08-10-android-ar-tailscale-serve.md)

修改程式前，請先查看負責範圍對應的最新開發紀錄，以及根目錄的
[AGENTS.md](./AGENTS.md)。

## 重要限制

- Job Store 與 Multiview Version History 目前保存在記憶體，FastAPI 重啟後不會恢復。
- Hunyuan3D GLB 目前沒有可信的真實世界尺度；Viewer 的 `arScale` 只是手動顯示倍率，不等同公分／毫米校正。
- Depth Anything V2／3 尚未成為本 Repo 的正式 API 或平台工作流；相關成果應標示為外部／本機研究原型。
- Asset Catalog 只持久化 `storage/` 中的圖片、模型與 metadata，不等同 Job persistence。
- OpenAI API Key 只能放在後端環境設定，前端不得保存金鑰。
- ComfyUI 預設由 FastAPI 後端呼叫，不由瀏覽器直接連線。
- iOS USDZ 轉換需要本機可用的 Blender 執行環境。
- Tailscale Serve 僅是目前開發／真機測試方式，不等同正式 production deployment。

## 授權

本專案採用 [GNU General Public License v3.0](./LICENSE) 授權。
第三方來源與修改說明請見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
