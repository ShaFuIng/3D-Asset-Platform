# 模型校正 Phase 1：補齊 asset_id 資料流(backend schema + frontend type)

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase1`
- 相關 Commit：尚未提交

## 本次目標

這是「GLB 真實尺度校正 + STL 列印匯出」計畫的 Phase 1，接續 Phase 0
（`kila606/model-calibration-phase0`，assets.db migration 機制 +
`parent_asset_id` 欄位）。這次目標跟 Phase 0 的 schema 改動完全獨立
——Phase 1 從 `main` 開新 branch，不接在 Phase 0 後面。

背景：後端在 job 完成時已經會把 GLB 註冊進 asset catalog、拿到一個
`asset_id`（`services/jobs.py`、`services/multiview_jobs.py` 呼叫
`register_model_file()` 的地方），但 `Create3DJobResponse`、
`JobResponse`、`MultiviewModelJobResponse` 這三個回應 schema 完全沒有
`asset_id` 欄位，前端從來沒有拿到過它。只有 Library 那條路徑（資料本來
就是從 `/api/library/assets` 撈出來的）天生帶 `asset_id`。這次要把
`asset_id` 補進 single-view job、multiview job 這兩條路徑，讓
`ViewerStagePage` 也能拿到，之後 Phase 4 的校正功能才有 key 可以用。

## 開始前重新調查發現的落差

先重新完整讀過所有相關檔案，發現背景描述有三個地方跟實際程式碼不一致，
確認方向後才動手（細節見對話紀錄，這裡摘要結論）：

1. **Response 組裝位置**：實際在 `routers/jobs_3d.py` 的
   `_job_response()`、`routers/multiview.py` 的 `_model_job_response()`，
   不是 `services/jobs.py`／`services/multiview_jobs.py`——這兩個 service
   檔案只管理內部 dataclass（`Job`、`MultiviewJob`、`MultiviewModelJob`）
   跟背景 job runner，不組裝任何 Pydantic response。
2. **「已經拿到 asset_id，只要塞進去」不成立**：`register_model_file()`
   的回傳值（含 `asset_id` 的 `AssetRecord`）在 `run_3d_job()` 跟
   `run_multiview_model_job()` 裡都被直接丟棄，`Job`／`MultiviewModelJob`
   這兩個 in-memory dataclass 從一開始就沒有欄位可以保存它。這不是查詢
   效能問題，是需要先讓這兩個資料結構能存住這個值。
3. **`MultiviewModelJobResponse` 的欄位形狀跟資料事實不合**：Multiview
   一次會產生兩個獨立 GLB（geometry、textured），各自有不同的
   `asset_id`，頂層一個 `asset_id` 欄位沒辦法同時代表兩者。

## 實際改動

**後端**：

- [backend/app/services/jobs.py](../../../backend/app/services/jobs.py)
  - `Job` dataclass 加 `asset_id: str | None = None`
  - `JobStore.update()` 加 `asset_id` 參數，carry-forward pattern 跟
    `prompt_id`／`model_path` 一致
  - `run_3d_job()` 接住 `register_model_file()` 的回傳值，傳進
    `store.update(..., asset_id=asset_id)`
- [backend/app/services/multiview_jobs.py](../../../backend/app/services/multiview_jobs.py)
  - `MultiviewModelJob` dataclass 加 `geometry_asset_id`、
    `textured_asset_id`（都預設 `None`）
  - `MultiviewJobStore.update_model_job()` 加對應兩個參數
  - `run_multiview_model_job()` 接住兩次 `register_model_file()` 的回傳值
- [backend/app/schemas.py](../../../backend/app/schemas.py)：
  `Create3DJobResponse`、`JobResponse` 加 `asset_id: str | None`；
  `MultiviewModelRef`（`geometry_model`／`textured_model` 共用的型別）加
  `asset_id: str | None`——`MultiviewModelJobResponse` 頂層不動，照上面
  第 3 點的結論分別放在兩個 model ref 裡
- [backend/app/routers/jobs_3d.py](../../../backend/app/routers/jobs_3d.py)：
  `create_3d_job()`、`_job_response()` 塞 `asset_id=job.asset_id`
- [backend/app/routers/multiview.py](../../../backend/app/routers/multiview.py)：
  `_model_job_response()` 兩個分支（尚未開始／正常組裝）都塞對應的
  `asset_id`

搜過整個 repo 確認：`JobStore.update()`、`update_model_job()` 的呼叫端
都只在各自的 `run_*_job()` 函式內部，沒有其他 router／模組直接呼叫，
改動範圍沒有外溢。

**前端**：

- [frontend/src/types/api.ts](../../../frontend/src/types/api.ts)：
  `Create3DJobResponse`、`JobResponse` 加 `asset_id: string | null`；
  `MultiviewModelJobResponse` 的 `geometryModel`／`texturedModel` 加
  `assetId: string | null`
- [frontend/src/api/client.ts](../../../frontend/src/api/client.ts)：
  `MultiviewModelJobResponseBody`（snake_case，對應後端原始 JSON）加
  `asset_id`；`toMultiviewModelJob()` 轉換函式把它映射成 `assetId`

`WorkspaceContext.tsx`、`ViewerStagePage.tsx` 確認完全不用動：追蹤過
資料流，`WorkspaceContext.tsx` 對 single-view 用
`{ ...entry, job: nextJob }`、對 multiview 用 `modelJob: nextModelJob`
——兩邊都是把 API 回來的整個物件存進 state，沒有另外定義窄化的
type，只要 `types/api.ts` 有這個欄位就自動能取用。`ViewerStagePage.tsx`
本身完全沒有 import 任何 job response 型別，只讀
`WorkspaceContext` 已經處理好的 local state。這次任務要求「不接到
UI」，所以這兩個檔案這次維持不動，資料留給 Phase 4 使用。

## 驗證方式與結果

**後端**：在三個既有測試裡擴充斷言，驗證 `asset_id` 在「處理中」正確
回傳 `None`、在「完成」時正確對應到 asset catalog 裡實際登記的
`asset_id`（不是隨便塞的假值）：

- `test_create_3d_job_success`：新建的 job，`asset_id` 為 `None`
- `test_job_status_schema_for_all_states`：遍歷所有 `JobStatus`，
  `succeeded` 狀態驗證 `asset_id` 正確回傳，其餘狀態驗證為 `None`
- `test_run_3d_job_succeeds`：真正跑一次 `run_3d_job()`，驗證
  `job.asset_id` 跟 `GET /api/3d/jobs/{job_id}` 回傳的 `asset_id`
  都等於 asset catalog 裡實際登記的那筆 `asset_id`
- `test_run_multiview_model_job_saves_two_models`：真正跑一次
  `run_multiview_model_job()`，驗證 `geometry_asset_id`／
  `textured_asset_id` 跟 `GET .../model-job` 回傳的
  `geometry_model.asset_id`／`textured_model.asset_id`，都分別對應到
  asset catalog 裡 geometry／textured 各自的 `asset_id`
- 新增 `test_model_job_not_started_returns_null_asset_ids`：
  `start_model_job()` 都還沒呼叫過（`model_job is None`）時，
  `GET .../model-job` 的兩個 `asset_id` 都正確回傳 `None`，不噴錯

```text
182 passed, 1 warning in 5.81s
```

全部通過（181 個既有測試 + 1 個新增）。

**前端**：這個 sandbox 完全沒有原生 Node.js／npm 安裝（`node`/`npm`
指令都找不到）；只有 WSL 底層對應到 Windows 端的
`/mnt/c/Program Files/nodejs/node.exe`，透過 interop 直接執行
`node.exe --version` 可以動（回報 `v20.18.0`），但用它去跑
`npm-cli.js` 對 Linux 側的專案路徑時，WSL 的路徑轉譯把參數路徑轉壞了
（`Cannot find module '\\wsl.localhost\...\node_modules\npm\bin\npm-cli.js'`），
沒有進一步嘗試更迂迴的解法（例如透過 `cmd.exe /c` 或改用 UNC 路徑手動
拼接），因為這已經超出這次改動本身該花的力氣。**沒有實際跑
`npm run typecheck`**，改用人工檢查這次改到的三個檔案（
`types/api.ts`、`api/client.ts`）：確認 `MultiviewModelJobResponseBody`
（snake_case）→ `toMultiviewModelJob()`（映射）→
`MultiviewModelJobResponse`（camelCase）三層欄位互相對得上，
`JobResponse`／`Create3DJobResponse` 的欄位型別跟後端 schema 一致，
沒有欄位改名或刪除，只有新增 nullable 欄位。這點沒有機器驗證，記錄下來
供之後在有 Node.js 的環境重新確認。

## 已知問題

- 前端型別改動沒有透過 `tsc` 實際編譯驗證過，只有人工檢查（見上）。
- `asset_id`／`assetId` 目前沒有接到任何 UI，純粹是資料流補齊，
  Phase 4 開始使用之前不會有任何使用者可見的變化。
- Multiview 的 geometry／textured 兩個模型的 `asset_id` 目前各自獨立，
  如果 Phase 4 校正功能要讓兩個 variant 共用同一份校正結果，需要另外
  設計，這次沒有處理。

## 下一步

- Phase 2／3：決定 baking 服務要怎麼使用 Phase 0 的 `parent_asset_id`
  跟這次補齊的 `asset_id`。
- 之後在有 Node.js 的環境重新跑一次 `npm run typecheck` 確認前端型別
  改動沒有編譯錯誤。
