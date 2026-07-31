# 生成式 AI 可編輯 3D 資產平台

本專案目標是建立一套可產生、預覽並逐步編輯 3D 資產的生成式 AI 平台。
目前已完成可操作的「單張圖片生成／上傳 → 3D Job → GLB 預覽」MVP，
並開始建立三視圖工作區與模型檢查工具。

## 目前進度

### 已完成

- Vite + React + TypeScript 前端與對話式工作區
- OpenAI 對話式圖片生成與多輪圖片修改
- 本機圖片上傳、圖片選擇與生成圖庫
- FastAPI 圖片與 3D 生成 API
- ComfyUI Hunyuan3D Workflow 提交與 Job 狀態輪詢
- GLB 儲存、下載與前端載入
- Three.js 模型檢查 Viewer
  - Original／Clay／Normal／Wireframe 模式
  - Grid／Axes、無陰影多方向補光
  - Mesh／Vertices／Triangles 統計
- 三視圖頁面與工作區 UI 骨架
- GPL-3.0 授權與第三方來源標示

### 尚未完成

- 真正的前／側／後三視圖生成與後續 3D Workflow
- Job、生成歷史與模型版本的持久化
- Mesh 部件拆分、材質編輯、拓樸檢查與骨架／IK
- 多 worker 共用 Job 狀態與正式任務佇列
- 完整的正式環境與長時間生成穩定性驗證

## 最近驗證

2026-07-31 合併至 `main` 後：

- 後端測試：`39 passed`
- 前端建置與瀏覽器操作：通過
- 生成 GLB 的 Three.js 顯示與檢查功能：本機驗證正常

## 專案目錄

```text
3D-Asset-Platform/
├─ frontend/             # React frontend and Three.js GLB viewer
├─ backend/              # FastAPI backend and generation services
├─ workflows/            # ComfyUI API workflows
├─ storage/              # Generated assets (not tracked by Git)
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

## 授權

本專案採用 [GNU General Public License v3.0](./LICENSE) 授權。
第三方來源與修改說明請見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
