# 2026-08-04：Asset Library 與 Multiview Guided Regeneration

## 目標

將專案從單次生成工作區擴充為可以管理 Storage 資產、對單一 Multiview
視角反覆調整，並保留 Candidate 與歷史版本的可操作 MVP。

## 完成內容

### 分階段工作區

- 前端依 Reference、Mode、Views、Generate、Inspect 拆分路由。
- Single 與 Multiview Job 身分由 URL 中的 pipeline 與 job id 區分。
- 生成工作輪詢移至 Workspace Context，切換頁面後仍會持續更新。
- 重新整理仍會失去記憶體中的 Job tracking，介面會明確提示此限制。

### Reference 圖片

- 支援 OpenAI 對話式生成、本機上傳與指定圖片修改。
- 指定圖片修改會建立新的 Edited asset，不覆寫原圖。
- 新對話只清除對話脈絡，不刪除圖片或既有 Job。
- Gallery 圖片可隱藏與恢復，技術 ID 集中在 Technical Details。

### Asset Library

- 新增 SQLite Asset Catalog，啟動時盤點 `storage/images` 與
  `storage/models`。
- 圖片與模型寫入 Storage 後主動登記 source、parent、job、reference、
  view、pipeline 與 model variant metadata。
- 新增圖片／模型／垃圾桶頁籤、搜尋、篩選、排序、分頁、預覽與下載。
- 圖片可以從 Asset Library 設為目前 Reference。
- Trash／Restore 不直接刪除檔案；Permanent Delete 會檢查 dependency、
  live Job reference、AssetUsageGuard 與安全路徑。
- Runtime SQLite 檔案已由 `.gitignore` 排除。

### Multiview Guided Regeneration

同一個 Front／Left／Back slot 支援兩種策略：

- `local_reroll`
  - 使用原始 Reference。
  - 使用固定英文視角 Prompt 與新的 Seed。
  - 交由本機 Qwen single-view workflow 生成一張 Candidate。
- `openai_edit`
  - 使用該 slot 的 Current image。
  - 使用者可輸入中文調整需求。
  - 後端加入視角、identity、pose、比例與未指定細節保留規則，再呼叫
    OpenAI Image Edit。

兩種策略都使用 Background Task、per-view atomic guard、
regeneration attempt id 與 AssetUsageGuard。成功只更新 Candidate，
不覆寫 Current；失敗保留既有 Current 與 Candidate。

### Multiview Version History

- 初始圖片、Local Reroll 與 GPT Edit 結果依生成順序保存。
- Lightbox 可用縮圖列與 Previous／Next 預覽版本。
- 瀏覽版本不修改 Job；使用者必須先設定 Candidate，再按 Accept。
- 選擇目前 Current 可清除尚未接受的 Candidate。
- Trash／Missing 版本可顯示但不能設為 Candidate。
- Current／Candidate 會阻擋永久刪除；History-only 版本可以刪除並從
  live JobStore 清除引用。

## 主要 API

### 圖片與資產

- `POST /api/images/{source_image_id}/edits`
- `GET /api/library/assets`
- `POST /api/library/assets/{asset_id}/trash`
- `POST /api/library/assets/{asset_id}/restore`
- `DELETE /api/library/assets/{asset_id}`

### Multiview

- `POST /api/multiview/jobs`
- `POST /api/multiview/jobs/{job_id}/views/{view}/regenerate`
- `POST /api/multiview/jobs/{job_id}/views/{view}/candidate`
- `POST /api/multiview/jobs/{job_id}/views/{view}/accept`
- `POST /api/multiview/jobs/{job_id}/model-job`

Regenerate request：

```json
{
  "strategy": "local_reroll"
}
```

或：

```json
{
  "strategy": "openai_edit",
  "instruction": "將左側袖子改成黑色，其他細節保持一致"
}
```

## 驗證結果

2026-08-04：

- Backend：`155 passed, 1 skipped`
- Frontend：`npm run typecheck` 通過
- Frontend：`npm run build` 通過，只有既有 chunk size warning
- 人工驗證：
  - Single 與 Multiview 完整流程
  - Local Reroll 只更新指定視角 Candidate
  - GPT 中文指令調整
  - Candidate Accept 與歷史版本切換
  - Asset Library Trash／Restore／Permanent Delete

## 已知限制

- Multiview JobStore 與 Version History 仍是 in-memory。
- FastAPI 重啟後無法回到舊 Multiview 工作階段；完成檔案仍保留於
  Storage 與 Asset Library。
- SQLite Asset Catalog 不保存完整 Job 狀態。
- 多 worker 尚未共享 JobStore。
- 正式環境部署與長時間並行生成尚未驗證。
- 目前前端以功能與操作流程為主，完整遊戲風格視覺與動畫留待下一階段。

## 下一步

- 進行整體遊戲風格 UI、動畫與 Responsive Design。
- 評估持久化 Job／Version Workspace 的資料模型。
- 強化長時間生成、取消操作與正式 Queue。
- 繼續研究 Mesh 部件拆分、材質、拓樸與 Rig／IK。
