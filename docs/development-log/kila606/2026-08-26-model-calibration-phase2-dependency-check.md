# 模型校正 Phase 2：校正 asset 的依賴關係

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase2`
- 相關 Commit：尚未提交

## 本次目標

這是「GLB 真實尺度校正 + STL 列印匯出」計畫的 Phase 2，接在 Phase 0
（`parent_asset_id` 欄位 + migration 機制）之後，讓這個欄位第一次有實際用途：
校正後的 model asset 存在時，原始（raw）model asset 不能被永久刪除，避免留下
一筆來源已經消失、卻還有 `parent_asset_id` 指著它的孤兒記錄。

這個 branch 是從 `main`（已含 Phase 0 的 migration commit）開出來的，**不含**
Phase 1 的 `asset_id` response 改動——Phase 2 只需要 Phase 0 的
`parent_asset_id` 欄位，跟 Phase 1 沒有相依關係。

## 現況調查

動手前重新讀過一次 `services/library.py`、`asset_catalog.py`、
`routers/library.py`，跟前端的 `LibraryPage.tsx`/`api/client.ts`，確認：

1. `_ensure_no_dependencies()`（[services/library.py:96-119](../../../backend/app/services/library.py)）
   對 image 的依賴是用 SQL 查詢（`find_children()`／`find_references()`），找到就
   直接 `raise ApiError(409, "asset_in_use", ...)`，呼叫端 `permanently_delete_asset()`
   不接回傳值、不 try/except，例外直接往上炸給 FastAPI 的全域 handler。
2. 這個檢查目前**只套用在永久刪除**，`trash_asset()` 完全不檢查任何依賴/使用中狀態
   ——`tests/test_library.py` 的 `test_in_use_asset_blocks_permanent_delete_but_allows_trash`
   證實這是整個 repo 的既有設計原則（trash 是可逆軟刪除，永遠允許；只有不可逆的
   永久刪除才把關）。**已跟使用者確認：這次維持現況，新的 model 依賴檢查一樣只
   套用在永久刪除，不擴大到 trash。**
3. `AssetCatalog` 沒有現成方法可以查「誰的 `parent_asset_id` 指向某個
   asset_id」，需要新增。
4. 錯誤訊息慣例：同一個 code `asset_in_use` 在多個檢查裡重複使用，用不同
   `message`/`details` 區分；前端完全不看 `details`、也不特別分辨 `code`，只是把
   `ApiError.message` 原文顯示給使用者——這次沿用完全一樣的訊息文字跟
   `details.dependents` 形狀，**不需要任何前端改動**。

## 這次怎麼做

- [backend/app/asset_catalog.py](../../../backend/app/asset_catalog.py)：
  - 新增 `find_derived_assets(parent_asset_id)`，跟 `find_children()`／
    `find_references()` 同樣的一欄 `SELECT * FROM assets WHERE parent_asset_id = ?`
    pattern
  - `initialize()` 的 `executescript` 加一條
    `CREATE INDEX IF NOT EXISTS idx_assets_parent_asset_id ON assets(parent_asset_id)`
    ——不走 migration 版本號（`CREATE INDEX IF NOT EXISTS` 本身每次啟動都會重新
    判斷），沒有動 Phase 0 已經定案的 `SCHEMA_VERSION`/`_MIGRATIONS`
- [backend/app/services/library.py](../../../backend/app/services/library.py)：
  `_ensure_no_dependencies()` 從「非 image 直接 return」改成依 `asset_type` 分流
  ——`image` 沿用原本兩個查詢，`model` 改查 `find_derived_assets()`，其餘類型維持
  原本直接放行。找到依賴時的錯誤訊息/`details` 形狀完全沒變。
  呼叫端 `permanently_delete_asset()` 不用改。

## 驗證方式與結果

新增 4 個測試：

- `backend/tests/test_asset_catalog.py::test_find_derived_assets_returns_calibrated_children_and_filters_unrelated`
  ——單元測試新的 `find_derived_assets()`，建三筆 model asset（raw、校正後子
  asset、不相關的另一筆），確認只查到子 asset，濾掉不相關的
- `backend/tests/test_library.py::test_model_with_calibrated_child_cannot_be_deleted`
  ——raw model 有一筆手動建的校正後子 asset（`parent_asset_id` 指向 raw，模擬
  Phase 3/4 baking 服務還沒做出來前的結果），trash raw 後永久刪除，驗證 409 +
  `asset_in_use` + `details.dependents` 帶正確的子 asset id
- `backend/tests/test_library.py::test_model_without_calibrated_child_can_be_deleted`
  ——沒有子 asset 的 model，trash 後永久刪除正常成功（200），確認新邏輯沒有
  誤擋正常情況
- `backend/tests/test_library.py::test_calibrated_child_itself_can_be_deleted`
  ——反過來永久刪除校正後的子 asset本身（它沒有自己的子 asset），正常成功，且
  raw asset 不受影響——確認依賴方向只會擋「parent 被刪」，不會反向級聯

```text
185 passed, 1 warning in 6.16s
```

全部通過（這個 branch 的既有基準 181 個 + 這次新增 4 個）。既有的
`test_model_delete_does_not_delete_reference_or_other_variant`（沒有校正子
asset 的既有情境）也在其中，確認新邏輯沒有把它變成失敗。

## 已知問題

- 這次只處理「擋下刪除」本身；「刪除校正後 asset 時要不要順便清掉它跟 raw asset
  的關聯」之類的下游情境，留給之後的 Phase。
- 手動建構校正後子 asset 的方式（直接 `catalog.upsert_asset()`）只是這次測試用來
  模擬 Phase 3/4 baking 服務尚未存在的產出，實際 baking 服務接上後這幾個測試的
  建構方式可能需要對照真實流程再檢視一次。

## 下一步

- Phase 3／4：設計 baking 服務本身，決定校正後 asset 實際是怎麼被建立、
  `parent_asset_id` 在那個流程裡怎麼填入。
