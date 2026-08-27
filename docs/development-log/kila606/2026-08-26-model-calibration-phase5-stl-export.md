# 模型校正 Phase 5：STL 匯出

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase5`
- 相關 Commit：尚未提交

## 本次目標

把校正後的 GLB（不是 raw GLB）轉成 STL，頂點乘 1000（公尺→毫米），並加
對應 API endpoint。asset 沒有 active 的校正後版本就擋下，回傳明確錯誤，
不能讓使用者匯出一個尺度不明的 STL。**這次明確不含前端 UI**（Phase 6）。

## 分支狀態

動手前先讀完 Phase 0/2/3/4 全部四篇開發紀錄（沒有獨立的 Phase 1 那篇——
`asset_id`-in-job-response 那次工作從沒被帶進這條 branch 系列），再重新
讀過目前實際程式碼確認一致。這個 branch 完整含 Phase 0（`ce84f0c`）、
Phase 2（`da55201`）、Phase 3（`48e1a08`）、Phase 4（`2876c02`），動手前
`pytest` 基準 **197 passed**，跟 Phase 4 開發紀錄記錄的數字一致——這次
沒有再遇到前幾輪那種「branch 內容中途變化」的狀況。

## 現況調查結果

1. **怎麼從 raw asset_id 找到目前 active 的校正後版本**：跟 Phase 4 的
   `asset_response()`/`calibrate_asset()` 同一個 pattern——
   `[child for child in catalog.find_derived_assets(asset_id) if
   child.deleted_at is None]`。Phase 4 選定的 (b) 策略（重新校正自動
   trash 舊的）保證了「任何時刻一個 raw asset 最多只有一筆 active 校正後
   子 asset」這個不變量，這次直接依賴它，不用另外防禦「多筆同時 active」
   的情況。沒有 active 校正版本時，照 `asset_not_in_trash` 的既有慣例，
   用 `ApiError(409, "asset_not_calibrated", ...)`。
2. **（實測，這次最重要的部分）驗證 Phase 3 烘焙假設 + trimesh STL API**：
   造一個合成 raw GLB，直接呼叫真正的 Phase 3 `_load_and_bake_scale()`
   校正到 15cm，重新載入：`reloaded.bounds` 直接就是 `0.15`（15cm）——
   **確認 Phase 3 當初「烘焙進頂點資料」的假設成立**，STL 匯出可以直接
   信任這份頂點資料，不需要處理任何場景圖 transform。另外兩個發現：
   - **trimesh 不會自動做 STL 單位換算**：把校正後 GLB（單位公尺）直接
     匯出成 STL，重新載入量出來還是 `0.15`，不是 `150`——STL 格式本身
     沒有單位概念，「STL=毫米」只是列印軟體業界慣例，這次必須自己乘
     1000，不能假設任何工具會幫忙做。
   - `Scene.dump(concatenate=True)`（原本考慮拿來把 Scene 攤平成單一
     mesh 的寫法）在釘住的 `trimesh==5.0.0` 已經標記
     `DEPRECATED FOR REMOVAL APRIL 2025`，改用官方建議的
     `Scene.to_geometry()`，實測結果一致、無 warning。
3. **Endpoint 形狀**：STL 匯出是可重複取得、冪等的操作（同一個校正結果，
   STL 內容永遠一樣），性質上更接近既有的 GLB `/content`、USDZ `/usdz`
   這兩個唯讀 `GET` 端點，不是 Phase 4 那種「觸發一次性動作、建立新
   資源」的 `POST`——這次用 `GET`。
4. **檔案回傳慣例**：重新讀過
   [routers/library.py](../../../backend/app/routers/library.py) 的
   USDZ 端點——寫進磁碟、快取在跟來源 GLB 同一個資料夾
   （`glb_path.with_suffix(".usdz")`），完全沒有註冊進 `AssetCatalog`，
   靠 `destination.exists()` 判斷要不要重轉。STL 這次完全比照：快取檔案
   放在跟**校正後 GLB**（不是 raw GLB）同一個資料夾、
   `.with_suffix(".stl")`、不進 catalog。

## 這次怎麼做

- `backend/app/services/model_calibration.py` 新增：
  - `export_calibrated_stl(catalog, asset_id) -> Path`：解析 asset_id
    目前 active 的校正後子 asset，`scene.apply_scale(1000.0)` 之後用
    `scene.to_geometry()` 攤平（STL 只有幾何資料，沒有材質，
    `to_geometry()` 剛好把 transform 烘焙進頂點、回傳單一 `Trimesh`），
    匯出、快取（檔案已存在就跳過重算）
  - `_require_active_calibrated_asset(catalog, asset_id) -> AssetRecord`：
    先 `require_asset()` 擋 404，再用 `find_derived_assets()` 過濾
    active 判斷「有沒有校正過」，沒有就 409 `asset_not_calibrated`
- `backend/app/routers/library.py` 新增
  `GET /api/library/assets/{asset_id}/stl`——同步直接呼叫
  `export_calibrated_stl()`，不包 `run_in_executor`（延續 Phase 3/4 的
  理由：這個 codebase 沒有任何地方用 executor，這次運算量比 Phase 3
  baking 更小，STL 沒有材質/貼圖要處理）。`media_type="model/stl"`——
  STL 沒有 IANA 正式登記的 MIME type，這是我選的業界常見值，這個 repo
  第一次匯出 STL，沒有既有先例可循。
- **`asset_id` 只接受 raw asset 的 id，不額外支援傳校正後 asset 自己的
  id**（已跟你確認維持這個限制，計畫裡列出的「可以讓兩種 id 都能用」
  這個分支這次沒有做）。

## 測試結果

新增 7 個測試：

**`backend/tests/test_model_calibration.py`**（service 層）：
- `test_stl_vertices_are_1000x_calibrated_glb`——不只各自斷言 STL 是
  150mm、校正 GLB 是 0.15m，還直接算兩者比例 `stl_mm / glb_m ≈ 1000`，
  驗證的是「就是 1000 倍」這個關係本身
- `test_stl_export_blocked_when_not_calibrated`
- `test_stl_export_missing_asset_returns_404`
- `test_stl_export_uses_newest_active_calibration_after_recalibration`——
  校正兩次後，確認 STL 用的是新的（20cm），不是被 trash 掉的舊的（10cm）
- `test_stl_export_caches_and_reuses_file`——monkeypatch
  `trimesh.load`，確認第二次呼叫完全沒有重新解析檔案

**`backend/tests/test_library.py`**（HTTP endpoint 層）：
- `test_get_stl_endpoint_returns_file`
- `test_get_stl_endpoint_without_calibration_returns_409`

```text
204 passed, 3 warnings in 7.66s
```

全部通過（197 既有 + 7 新增）。

## 已知問題

- 不含前端 UI（Phase 6）。
- STL 沒有材質/顏色資訊——這是 STL 格式本身的限制，不是這次實作的缺口。
- `media_type="model/stl"` 是自選值，沒有正式 MIME 登記可以照抄。
- 這次 endpoint 只接受 raw asset id，不支援直接傳校正後 asset 自己的
  id——計畫裡有列出這個備選分支，已跟你確認這次維持限制不做。

## 下一步

- Phase 6：前端 UI，讓使用者能設定校正目標公分數、下載 STL。
