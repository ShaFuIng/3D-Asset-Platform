# 模型校正 Phase 4：校正 API endpoint

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase4`
- 相關 Commit：尚未提交

## 本次目標

把 Phase 3 的純函式 `bake_calibrated_model()` 包成一個前端可以呼叫的
HTTP endpoint，並處理 Phase 3 明確留給這裡決定的產品面問題：重複校正
同一個 asset 時的行為、讓前端知道某個 asset 有沒有被校正過。**這次明確
不處理 iOS/USDZ**（維持 Phase 3 排除範圍）、**不含前端 UI**（Phase 6）。

## 分支狀態

這個 branch 含 Phase 0（`ce84f0c`）、Phase 3（`48e1a08`）。**Phase 2
（`da55201 feat(library): block permanent delete when calibrated child
exists`）是調查過程中才出現在這個 branch 上的**——一開始檢查
`services/library.py` 時 `find_derived_assets()`／model 依賴檢查都還不
存在，中途重新確認時已經有了，這次的計畫跟實作都是照重新確認過的實際
狀態走，不是憑最早那次檢查的印象。不含 Phase 1（`asset_id` 塞進
job response 那次）。動手前完整 `pytest` 基準：191 passed。

## 現況調查結果

1. **既有「動作型」endpoint 慣例**：`trash`/`restore` 都是
   `POST /api/library/assets/{asset_id}/<動作>`，router `async def` 但
   直接呼叫的 service 函式（`trash_asset`/`restore_asset`）其實是純同步
   函式；沒有 request body；response 直接複用 `LibraryAssetResponse`；
   錯誤處理完全靠 service 層 `raise ApiError(...)`，router 不接、不包
   try/except。
2. **`LibraryAssetResponse`/`asset_response()` 現況**：完全沒有任何校正
   相關欄位，連 Phase 0 就有的 `parent_asset_id` 都還沒被
   `asset_response()` 讀出來。
3. **CPU-bound 同步函式在 async route 裡怎麼呼叫**：全 backend 搜過
   `run_in_executor`/`to_thread`/`ThreadPoolExecutor`——一個都沒有。既有
   精確先例：`routers/images.py` 的 `upload_image()` 直接同步呼叫
   `storage.save_uploaded_image()`（內部有 PIL 驗證 + 阻塞式寫檔），完全
   沒包 executor。這次比照，直接同步呼叫 `bake_calibrated_model()`。
4. **重複校正的既有慣例**：Multiview 的 geometry/textured 共存在同一個
   `reference_image_id` 底下，只能證明「同一個 key 底下多個子 asset
   共存」架構上沒問題，但那是同一次生成刻意產出的兩個不同 variant，跟
   「同一個目標重做一次」性質不同，沒有現成慣例可以直接照搬——這是全新
   的產品決策。三個選項列給你選，**已選 (b)：重新校正時自動 trash 舊的
   校正後 asset**，且確認「先 trash 舊的再 bake 新的」這個執行順序。

## 這次怎麼做

- `backend/app/schemas.py`：
  - `LibraryAssetResponse` 加 `parent_asset_id: str | None`、
    `calibrated_asset_ids: list[str]`
  - 新增 `CalibrateAssetRequest(target_max_dimension_cm: float)`——刻意
    不加 Pydantic 層的 `gt=0` 限制，因為 `bake_calibrated_model()` 已經
    有一致的 `ApiError(400, "invalid_target_dimension", ...)`，兩層都驗證
    同一個條件只會產生兩種不同形狀的錯誤，不如統一交給 service 層
- `backend/app/services/library.py`：
  - `asset_response()` 簽名加 `catalog` 參數，才能查
    `find_derived_assets()` 組出 `calibrated_asset_ids`；同檔案內
    `trash_asset()`/`restore_asset()` 兩個呼叫端也跟著更新
- `backend/app/services/model_calibration.py`：
  - 新增 `calibrate_asset(catalog, storage, asset_id,
    target_max_dimension_cm) -> AssetRecord`——先把
    `find_derived_assets(asset_id)` 裡還 active 的都 `trash_asset()`
    掉，再呼叫 `bake_calibrated_model()`
  - **`calibrate_asset()` 特意放在這個檔案而不是 `services/library.py`**：
    一開始想放 `library.py`（呼叫 `bake_calibrated_model`），但
    `model_calibration.py` 本來就要 `from .library import
    asset_content_path, require_asset`，兩邊互相 import 會在模組載入時
    炸出 `ImportError`（partially initialized module）。改成讓
    `model_calibration.py` 單方向依賴 `library.py`（不回頭），
    `calibrate_asset()` 放在 `model_calibration.py` 裡，`routers/library.py`
    照 `jobs_3d.py` 那種「router 從多個 service 模組各自 import」的既有
    模式，同時 import `services.library` 跟 `services.model_calibration`
    兩個模組的函式——這解決了循環引用，也沒有發明新的 import 慣例
- `backend/app/routers/library.py`：新增
  `POST /api/library/assets/{asset_id}/calibrate`（`201 Created`，
  因為這次是建立新 asset，不是修改既有 asset 狀態，跟
  `POST /api/images/upload` 用 201 的道理一樣）；`list_library_assets()`/
  `get_library_asset()` 都跟著補上 `catalog` 參數傳給 `asset_response()`

**效能取捨（已確認接受）**：`list_library_assets()` 現在對每一筆 asset
都會多查一次 `find_derived_assets()`（有索引，Phase 2 已加），一頁最多
100 筆，等於最多 100 次額外查詢——單機/單使用者規模下可接受，之後
asset 數量大幅增加需要再優化成 batched 查詢。

## 測試結果

新增 6 個測試（`backend/tests/test_library.py`，HTTP endpoint 層級；
Phase 3 的 `test_model_calibration.py` 已經涵蓋 service 函式本身的量測/
材質驗證，這裡不重複）：

- `test_calibrate_endpoint_creates_new_asset_with_parent_asset_id`
- `test_recalibrating_trashes_previous_calibrated_asset`——驗證第一次
  結果被 trash（`deleted_at is not None`，可復原）、第二次是唯一 active
  的
- `test_calibrate_missing_asset_returns_404`
- `test_calibrate_non_model_asset_returns_400`
- `test_calibrate_invalid_target_returns_400`
- `test_calibrated_asset_appears_in_library_list_with_parent_asset_id`——
  驗證 `GET /api/library/assets` 列表本身也帶得到新欄位

```text
197 passed, 3 warnings in 7.37s
```

全部通過（191 既有 + 6 新增）。

## 已知問題

- 不含 USDZ/iOS 重轉、不含前端 UI（Phase 6）。
- 選定的 (b) 策略採「先 trash 舊的再 bake 新的」：如果 baking 中途失敗
  （例如 bounding box 無效），raw asset 會短暫處於「沒有任何 active
  校正結果」的狀態，直到使用者重新呼叫一次成功為止。已跟你確認接受這個
  取捨，備選的「先 bake 成功再 trash 舊的」沒有實作。
- `list_library_assets()` 的 N+1 查詢取捨（見上）。
- Phase 1 的 `asset_id`-in-job-response 沒有包含在這個 branch。

## 下一步

- Phase 6：前端 UI 呼叫這個 endpoint，顯示 `parent_asset_id`/
  `calibrated_asset_ids`。
- 之後另一個獨立 phase：校正後 GLB 的 USDZ 重轉。
