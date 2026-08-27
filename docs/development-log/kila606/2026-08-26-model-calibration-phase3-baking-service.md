# 模型校正 Phase 3：GLB 校正 baking 服務

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase3`
- 相關 Commit：尚未提交

## 本次目標

把 Phase 0 的 `parent_asset_id` 欄位、Phase 2 的依賴檢查接上真正的校正
邏輯：給定 asset_id + 目標公分數，量測原始 GLB bounding box 最長邊，算出
scale_factor，用 trimesh 套用，寫出一份真實尺寸正確的新 GLB，並正確登記
進 asset catalog。**這次明確不處理 iOS/USDZ**（另開獨立 phase）、**不新增
API endpoint**（Phase 4 的範圍）、**不碰前端**——純粹交付一個可以被直接
呼叫、可以被完整測試的後端服務函式。

## 分支狀態備註

這個 branch 只含 Phase 0 的 migration commit，**不含 Phase 2 的依賴檢查
擴充**（`AssetCatalog.find_derived_assets()`／`_ensure_no_dependencies()`
的 model 分流那次是在 `kila606/model-calibration-phase2` branch 上以
未 commit 的工作目錄改動完成的，沒有被帶到這個新 branch）。這不影響這次
Phase 3 的實作——baking 服務本身只需要 Phase 0 的 `parent_asset_id`
欄位可以寫入，不會呼叫 Phase 2 新增的任何查詢/檢查函式——但代表如果現在
就要把這幾個 phase 合併成一個完整功能，Phase 2 的改動需要另外整合進來，
先在這裡記錄清楚。

## 現況調查結果

1. **`requirements.txt` + 相依驗證**：確認原本 8 個套件都沒有
   `numpy`/`trimesh`。在既有 `backend/.venv`（Python 3.12.3）實測
   `pip install trimesh numpy` 裝出 `trimesh==5.0.0`、`numpy==2.5.2`——
   `trimesh` 唯一必要相依就是 `numpy`。`pip check` 回報
   `No broken requirements found.`，`pip freeze` 確認其餘 8 個既有套件
   版本完全沒被動到。
2. **repo 裡沒有真的 GLB 檔案**——`find -iname "*.glb"` 全 repo 找不到
   任何檔案，既有測試用的 `GLB_BYTES`（`tests/conftest.py`）只是假的
   magic bytes，trimesh 無法解析。自己用 trimesh 造合成 fixture（單一
   textured box、10242 頂點+1024×1024 貼圖的 icosphere、雙 mesh 的
   Scene）實測 load→測 bounds→apply_scale→export 全流程：heavy 版本
   （446KB、10242 頂點）**總耗時 0.031 秒**，其中 0.029 秒是 export，
   `apply_scale()` 本身幾乎零成本。
3. **`AssetCatalog` 查 raw GLB 路徑**：沒有一步到位的方法，要
   `catalog.get_asset(asset_id)` 拿 `AssetRecord` 再
   `catalog.resolve_relative_path(asset.relative_path)`。`services/library.py`
   已經把這兩步包成 `require_asset()`／`asset_content_path()`（含存在性/
   `missing` 狀態驗證），這次直接重用，不重寫——`services/openai_client.py`
   已有跨 service 模組互相 import 的先例。
4. **`models_dir` 既有命名慣例**：扁平放置、無子目錄，命名前綴用「當下
   產生這個檔案的新 ID」（single-view 用 `{job_id}.glb`、multiview 用
   `{job_id}-geometry/-textured.glb`）。校正後 GLB 比照，用新產生的
   asset_id 當前綴：`{new_asset_id}-calibrated.glb`。
5. **（實測）`trimesh.load()` 讀 GLB 的回傳型別**：不管原始 GLB 是用單一
   `Trimesh` 匯出還是本來就是 `Scene`，`trimesh.load()` 讀回來**一律是
   `Scene`**（glTF/GLB 格式本身就是場景圖結構）。程式碼永遠當 `Scene`
   處理，不假設是 `Trimesh`。
6. **（實測，這次最重要的發現）`apply_scale()` 只改場景圖 transform，
   不動頂點資料**：直接讀出匯出後 GLB 的 glTF JSON chunk，scale 後的
   node 長這樣：`{"mesh": 0, "matrix": [0.075,0,0,0, 0,0.075,0,0,
   0,0,0.075,0, 0,0,0,1]}`——是一個純 scale 矩陣掛在 node 上，mesh 本身
   的頂點資料完全沒變。這對任何符合 glTF 規範的 viewer（`<model-viewer>`、
   Three.js、Blender）都沒問題，但代表任何直接讀 raw 頂點資料、不透過
   場景圖 transform 的下游程式碼會拿到未校正的錯誤尺寸。材質/貼圖本身
   （PBRMaterial + 1024×1024 貼圖 + UV）100% 保留，scale 前後 pixel data
   byte-for-byte 相同。

## 這次怎麼做

- `requirements.txt`：加 `trimesh==5.0.0`、`numpy==2.5.2`。
- `backend/app/services/model_calibration.py`（新檔案）：
  `bake_calibrated_model(catalog, storage, asset_id, target_max_dimension_cm) -> AssetRecord`。
  照 `services/library.py` 的風格寫成模組層級純函式（不是
  `blender_client.py` 那種要管理 subprocess 的 class，因為這裡沒有外部
  連線/長駐狀態）。核心邏輯：
  1. 重用 `require_asset()`／`asset_content_path()` 驗證 + 拿到 raw GLB
     路徑，`asset_type != "model"` 回 `ApiError(400, "invalid_asset_type", ...)`
  2. `trimesh.load(raw_path)` 永遠當 `Scene`，量測 `.bounds` 算
     `scale_factor = target_cm/100 / max_dimension_m`
  3. **採用「烘焙」做法**（回應一-6 的發現）：`scene.apply_scale(factor)`
     之後用 `scene.dump(concatenate=False)` 把場景圖 transform 直接烘焙進
     每個 geometry 的實際頂點座標，重建成一個新 `Scene` 再匯出——這樣
     輸出的 GLB 節點沒有殘留 transform matrix，raw 頂點資料本身就已經是
     公尺為單位的真實尺寸，不依賴下游是否正確處理 node transform
  4. 新檔名 `{new_asset_id}-calibrated.glb`，寫進 `storage.models_dir`
  5. 呼叫（擴充後的）`storage.register_model_file(..., asset_id=new_asset_id,
     parent_asset_id=raw_asset.asset_id)` 登記進 catalog，`pipeline`/
     `model_variant`/`related_job_id`/`reference_image_id` 都繼承自 raw
     asset（描述的是「這個模型怎麼生成的」，校正後還是同一個生成脈絡）
- `backend/app/storage.py` 的 `register_model_file()` 小幅擴充：加
  `asset_id: str | None = None`（**採用方案 (b)**：由呼叫端指定，讓校正後
  GLB 的檔名前綴等於實際登記進 catalog 的 asset_id，方便肉眼比對）、
  `parent_asset_id: str | None = None` 兩個新參數；`related_job_id`／
  `reference_image_id` 的型別標注從 `str` 放寬成 `str | None`（跟
  `AssetRecord` 對應欄位的型別一致，因為校正後 asset 需要能原封不動繼承
  raw asset 這兩個可能為 `None` 的欄位）。既有兩個呼叫端
  （`jobs.py`/`multiview_jobs.py`）都沒有傳新參數，行為完全不變
  （`asset_id or str(uuid.uuid4())` 在沒傳時等同原本的 `str(uuid.uuid4())`）。
- **同步執行，不走背景 job**：一-2 實測 0.031 秒（比一般網路 round trip
  還快），這個 codebase 已有更重的先例（`blender_client.py` 開整個
  Blender subprocess 都選擇同步 `await convert_or_raise(...)`），沒有理由
  為更輕量的 baking 走背景任務。函式本身寫成純同步（不是 `async def`），
  Phase 4 要不要包 `run_in_executor` 屆時再決定。

## 驗證方式與結果

新增 `backend/tests/test_model_calibration.py`（repo 裡沒有真的 GLB
fixture，測試檔案自己用 trimesh 造一個帶貼圖的合成 GLB）：

- `test_calibrated_bounding_box_matches_target_within_tolerance`：校正到
  15cm，reload 量測 bounding box，誤差 < 0.01cm
- `test_recalibrating_same_raw_asset_does_not_accumulate_error`：對同一個
  raw asset 分別校正到 10cm 跟 20cm（都指定同一個 raw asset_id，不是拿
  第一次結果當輸入），兩次結果各自精準對應各自的目標值，且各自登記成
  獨立 asset
- `test_calibration_preserves_material_and_texture`：reload 校正後 GLB，
  材質存在、貼圖 pixel data 跟原始 fixture 完全一致
- `test_calibrating_missing_asset_returns_404`／
  `test_calibrating_non_model_asset_returns_400`／
  `test_calibrating_non_positive_target_returns_400`：輸入驗證邊界情況

```text
187 passed, 3 warnings in 6.34s
```

全部通過（這個 branch 基準 181 個 + 這次新增 6 個）。另外確認過
`pip install -r requirements.txt` 乾淨安裝、`pip check` 沒有衝突。

## 已知問題

- 這次沒有處理 iOS/USDZ 重轉——校正後的 GLB 目前沒有對應的 USDZ，如果
  校正後的 asset 走現有 `/api/library/assets/{asset_id}/usdz` 端點，
  會用 Blender 從**校正後**的 GLB 轉出 USDZ（因為那條路徑本來就是用
  asset 自己的 relative_path 轉檔，跟是不是校正過無關），理論上是對的，
  但這次沒有專門驗證過。
- 沒有 API endpoint，重複校正同一個 raw asset 的「覆蓋策略」（要不要讓
  舊的校正結果變成孤兒、要不要提供清掉舊結果的方式）沒有在這次決定，
  留給 Phase 4。
- 這個 branch 不含 Phase 2 的依賴檢查擴充（見上面「分支狀態備註」），
  合併/上線前需要確認 Phase 2 的改動也一起帶上，不然「校正後 asset 存在
  時原始 asset 不能被永久刪除」這個保護不會生效。

## 下一步

- Phase 4：新增 API endpoint 呼叫 `bake_calibrated_model()`，決定重複
  校正的覆蓋策略、前端 UI。
- 之後另一個獨立 phase：校正後 GLB 的 USDZ 重轉驗證（這次明確排除）。
