# 生成式 AI 可編輯 3D 資產平台

本專案目標是建立一套可產生、預覽並逐步編輯 3D 資產的生成式 AI 平台。

目前第一階段已建立：

- Web 前端與 GLB 預覽介面
- 後端 API 與服務健康檢查
- 本機 ComfyUI 連線檢查
- 團隊開發與交接文件架構

## 專案目錄

```text
3D-Asset-Platform/
├─ frontend/             # Web frontend and GLB preview
├─ backend/              # FastAPI backend
├─ workflows/            # ComfyUI API workflows
├─ storage/              # Generated assets (not tracked by Git)
├─ prototype-reference/  # Original UI reference; do not modify
└─ docs/                 # Setup guides and development logs
```

## 文件入口

完整的環境版本、團隊安裝方式、啟動順序、服務 Port 與停止方式，請先閱讀：

- [專案文件與安裝指南](./docs/README.md)
- [團隊開發紀錄](./docs/development-log/README.md)

修改程式前，請先查看負責範圍對應的最新開發紀錄，以及根目錄的
[`AGENTS.md`](./AGENTS.md)。
