# iOS AR 打通：點擊觸發轉檔＋快取 endpoint、前端 loading／錯誤狀態

- 日期：2026-08-08
- 負責人：kila606
- 分支：`kila606/ar-model-viewer`
- 相關 Commit：尚未提交

## 本次目標

把前兩篇紀錄留下的兩塊拼起來：`ModelViewer.tsx` 已經有 AR 按鈕、
`BlenderClient` 已經能轉檔，但兩者沒有接線——USDZ 從沒被實際產生給
使用者用過。這次只做 **iOS 路徑**：Android 本來就是拿 GLB 直接動作，
這次完全沒動。

## 完成內容

### 後端：點擊觸發＋快取

- `backend/app/storage.py`：新增 `usdz_path_for_job()`，跟既有
  `model_path_for_job()` 同一種命名慣例（`{job_id}.usdz`，跟 GLB 放
  同一個 `storage/models/` 目錄）。
- `backend/app/routers/jobs_3d.py`：新增
  `GET /api/3d/jobs/{job_id}/usdz`，照既有
  `GET /api/3d/jobs/{job_id}/model` 的路由風格與檢查順序（job 不存在
  → 404、job 還在跑 → 409、job 失敗 → 409、GLB 不存在 → 404）。多一步：
  先看 `usdz_path` 檔案在不在，在就直接回傳（快取命中，不重轉）；不在
  才呼叫 `BlenderClient.convert_glb_to_usdz()`，成功後也回傳同一個
  `FileResponse`。**快取純粹是「檔案在磁碟上就不重轉」**，沒有另外做
  進度追蹤或 lock（見下方已知問題）。
- `backend/app/routers/multiview.py`：新增
  `GET /api/multiview/jobs/{job_id}/models/{kind}/usdz`，照
  `GET /api/multiview/jobs/{job_id}/models/{kind}` 的風格，USDZ 快取
  路徑用 `safe_path.with_suffix(".usdz")`（`{job_id}-geometry.usdz` /
  `{job_id}-textured.usdz`），geometry 跟 textured 各自獨立快取。
- `backend/app/main.py`：`app.state.blender_client = BlenderClient(app_settings)`
  ——`BlenderClient` 在前一篇紀錄裡寫好了但沒有任何 router 引用；這次
  是它第一次真的被接上。

### 失敗容錯

兩個新 endpoint 都用同一個 `_convert_to_usdz()` helper（各自檔案裡各
放一份，沒有抽共用 module——兩個 router 檔案目前的慣例本來就是各自
放自己的 response-building helper，不跨檔案 import，這裡照舊）：

```python
if not blender.settings.blender_executable:
    raise ApiError(503, "blender_not_configured", "...")
try:
    await blender.convert_glb_to_usdz(glb_path, usdz_path)
except BlenderClientError as exc:
    raise ApiError(502, "usdz_conversion_failed", "...") from exc
```

精神跟 multiview 既有的 geometry/textured `available` 拆分一致
（`_model_job_response`，[routers/multiview.py](../../../backend/app/routers/multiview.py)）：
一個子資源失敗不影響其他資源。實際做法不同的地方是：那個
`available: bool` 欄位是「查詢當下狀態」（純讀檔案存不存在，不會觸發
任何動作），USDZ 這邊因為是「點下去才轉」，沒有對應的無副作用查詢端
點可以回傳「available」欄位，所以走的是「呼叫這個 endpoint 本身可能
502/503，但這個失敗不會動到 job 本身的狀態、不會動到 GLB endpoint」
這個較窄但對應目標一致的保證——已經寫測試驗證兩個新 endpoint 失敗時
，`GET .../model`（GLB 下載）跟 `GET /api/3d/jobs/{job_id}`（job 狀態）
都還是正常的。

### 前端：iOS 專用的 loading／錯誤狀態

- `ModelViewer.tsx` 的 `iosSrc` prop 改名成 `usdzUrl`：語意從「已經有
  USDZ URL」改成「轉檔／快取 endpoint 的 URL，不確定有沒有轉好」。
- AR 按鈕的觸發機制從 model-viewer 的 `slot="ar-button"` 改成外部按鈕
  + `useRef` 直接呼叫 `modelViewer.activateAR()`（model-viewer 官方支援
  的替代整合方式，不是自己發明的）。原因：`slot="ar-button"` 是同步的
  ——點下去 model-viewer 立刻用當下的 `ios-src` 屬性判斷能不能觸發 AR
  ，沒辦法在「點擊」跟「真正觸發 AR」中間插入一段非同步的轉檔等待。
  改成外部按鈕後：
  - 非 iOS（Android／桌機）：`onClick` 直接呼叫 `activateAR()`，跟以前
    行為一致，**沒有多任何步驟**，Scene Viewer 邏輯完全是 model-viewer
    自己處理的，這邊沒有重寫。
  - iOS 且 `usdzUrl` 這次還沒 resolve 過：按鈕先進入 loading
    （文字變成「USDZ 轉檔中...」、`disabled` 期間跟既有按鈕
    disabled 樣式一致），`fetch(usdzUrl)`（就是打前面那個
    後端 endpoint，順便觸發轉檔＋拿到快取結果）。成功後
    `setAttribute('ios-src', usdzUrl)`（直接操作 DOM，不等 React
    重繪，因為 `activateAR()` 馬上要用到這個屬性）再呼叫
    `activateAR()`；同一個 session 內再點一次不會重打 API，直接
    `activateAR()`。
  - 失敗：`<p className="hint error">{message}</p>`，錯誤訊息優先取
    後端 `ApiError` 回應裡的 `error.message`（`blender_not_configured`
    / `usdz_conversion_failed` 那兩句），拿不到才用通用訊息。
- **視覺樣式完全沒新增任何 CSS**：loading 用「按鈕文字變成
  『...中...』+ `disabled`」，這是 `ViewCard.tsx`（重新抽選／GPT 調整
  按鈕）已經在用的模式，`button:disabled` 的透明度／`cursor` 已經是
  全站共用規則；錯誤訊息直接複用 `.hint.error`（`ViewCard.tsx` 的
  `{state === 'error' && slot?.error && <p className="hint error">...`
  就是同一個 class）。沒有為了這次改動另外調過顏色、字體或間距。
- `ViewerStagePage.tsx`：single 與 multiview 兩處呼叫都加上
  `usdzUrl`，用既有 `resolveApiUrl()` 組出對應的 `/usdz` endpoint
  網址（single 用 `jobId`；multiview 用 `jobId` + 當前選中的
  `activeModelKind`，兩者都跟 `geometryUrl`/`texturedUrl` 是同一個
  `job_id` 空間，已確認過 `routedJob.ts` 的比對邏輯）。

### 沒有改的地方

- **`LibraryPage.tsx` 沒有接 `usdzUrl`**：Library 的模型是透過
  `assets.db`（SQLite，持久化）查出來的，不保證對應的 Job 還活在
  記憶體裡（`JobStore`／`MultiviewJobStore` 都只在記憶體、重啟就沒了，
  這是 `docs/README.md` 既有的已知限制）。`LibraryAssetResponse` 雖然
  有 `related_job_id` 欄位，但拿它組 `/api/3d/jobs/{job_id}/usdz` 這種
  URL，遇到 Job 已經不在記憶體的情況會白白 404，UX 上是「AR 按鈕點下
  去顯示錯誤」而不是「這裡本來就沒有」，體感更差。這次任務描述明確只
  提到 `jobs_3d.py` 跟 multiview 的既有 pattern，沒提 Library，所以先
  不猜，留在下面「下一步」。Library 頁面的 AR 按鈕目前等同上一輪的
  行為：沒有 `usdzUrl` → iOS 顯示「缺少 USDZ 轉檔來源」錯誤、Android
  不受影響。

## 驗證方式與結果

後端（`/home/kila/miniconda3/envs/3d-asset-platform`，Python 3.10.11）：

```text
python -m pytest
```

結果：**173 passed**（上一篇紀錄的 165 基礎上，這次新增 8 個測試：
`test_jobs_3d.py` 4 個 + `test_multiview.py` 4 個，涵蓋轉檔成功且第二
次呼叫走快取不重轉、job 未完成 409、`BLENDER_EXECUTABLE` 未設定 503、
轉檔失敗 502 且不影響 job 狀態／GLB 下載、multiview 無效 kind 400）。

另外用真實 Blender（不是 mock）把新 endpoint整條路徑跑過一次：起一個
帶真實 `blender_executable` 路徑的 `TestClient`，塞一個真的 job + 真的
GLB（`storage/models/` 裡的 textured 測試模型），打
`GET /api/3d/jobs/{job_id}/usdz` 兩次：

```text
first call: 200 model/vnd.usdz+zip 5288751 bytes
second call (cached): 200 5288751 bytes，跟第一次 byte-for-byte 相同
cached file exists on disk: True 5288751 bytes
```

前端：

```text
npm run typecheck（tsc -b）
```

結果：exit 0，無錯誤（`ref` 型別、`ModelViewerElement` 轉型、
`usdzUrl` prop 改名後的呼叫端都沒有型別問題）。

**這次沒有做 Playwright headless 視覺驗證**——上一輪那次是使用者明確
要求「打開一次 AR 預覽畫面看視覺」才做的，這次任務描述沒有提到，照
`[[verification-ask-first]]` 的原則（先講再做這類會另外裝東西／開
dev server 的驗證步驟），留給使用者決定要不要另外跑一次。

## 已知問題

- **沒有併發保護**：兩個使用者（或同一個使用者快速點兩下）同時打還
  沒快取的 `/usdz` endpoint，會各自起一個 Blender process 寫同一個
  目的檔案，沒有 lock。以目前的使用情境（單人手動點擊）風險低，但
  沒有實測過同時觸發的行為（例如檔案寫到一半被另一個 process 覆蓋）。
- **Library 頁面沒有接 USDZ**，見上面「沒有改的地方」。
- **iPad 偵測**（`navigator.platform === 'MacIntel' && maxTouchPoints > 1`）
  沒有在真實 iPad 上測過，只在程式碼層面確認這是目前業界常見的
  iPadOS 13+ 偵測寫法；桌面 Mac 搭配觸控螢幕的邊緣案例理論上也會被
  誤判成 iOS，但目前應該沒有這類裝置會用到這個功能。
- 沿用前兩篇紀錄的已知問題：`arScale` 手動縮放沒變、`BLENDER_CONVERSION_TIMEOUT_SECONDS`
  預設值沒用大模型實測過、沒有真機（iPhone／Android）跑過完整 AR 流程。

## 下一步

- 決定 Library 頁面要不要支援 iOS AR：如果要，得先解決「Job 不在記憶體
  裡但 GLB 檔案還在」的情況要怎麼查到／要不要另外做一個不依賴 Job
  Store 的 `usdz` endpoint（直接用 `asset_id` 找 GLB 檔案路徑，不透過
  job_id）。
- 找一台真的 iPhone，連線到這個環境的 Vite dev server（先前那份紀錄
  提到用 tailscale serve），實際點一次「在 AR 中檢視」，確認整條
  fetch → activateAR() → Quick Look 真的會跳轉、USDZ 真的能開。
- 視覺驗證：如果要跑 Playwright headless smoke test 確認 loading/錯誤
  UI 沒有跟其他樣式衝突，需要使用者先確認再動手。
