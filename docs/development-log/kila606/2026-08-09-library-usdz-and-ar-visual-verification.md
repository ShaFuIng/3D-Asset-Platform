# Library 頁面 USDZ 支援（asset-based）＋ 三頁面 AR loading/錯誤狀態視覺驗證

- 日期：2026-08-09
- 負責人：kila606
- 分支：`kila606/ar-model-viewer`
- 相關 Commit：尚未提交（前三輪 `2a3dda8`／`c8f33ed`／`8a51cff` 已由使用者本人手動 commit）

## 本次目標

補上 [2026-08-08-ios-ar-usdz-wiring.md](./2026-08-08-ios-ar-usdz-wiring.md) 留下的
缺口：`LibraryPage.tsx` 還沒有 USDZ 支援。這次明確要求**不要走 job_id
那條路**（Library 資產可能對應到已經不在記憶體裡的 Job），改成
asset-based，直接照 `library.py` 既有的
`GET /api/library/assets/{asset_id}/content` pattern 做。同時把三個
頁面（ViewerStagePage single/multiview、LibraryPage）AR 按鈕的
loading→成功／loading→失敗狀態都用 Playwright 實際截圖驗證一次，不只
測正常路徑。

## 完成內容

- 新增 `GET /api/library/assets/{asset_id}/usdz`：照
  `get_library_asset_content` 的寫法，`require_asset()` 找資產、
  `asset_content_path()` 取得已驗證存在的 GLB 路徑（asset 不存在
  404、asset 是 image 型別 400、檔案實際遺失 409 都沿用既有邏輯，
  沒有另外重寫），USDZ 快取路徑用 `glb_path.with_suffix(".usdz")`。
  用真實 Blender 實測過：轉出來的 USDZ 內容正確，而且刻意用一個
  `related_job_id` 指向不存在 Job 的 asset 測試，`GET /api/3d/jobs/{那個id}`
  回 404、但 `GET /api/library/assets/{asset_id}/usdz` 正常轉檔成功
  ——證實真的不依賴 Job Store。
- **重構**：發現三個 `/usdz` endpoint（`jobs_3d.py`、`multiview.py`、
  這次新增的 `library.py`）如果各自複製一份「檢查快取存在 → 檢查
  `BLENDER_EXECUTABLE` → try/except 轉檔 → 502/503」的邏輯，會是
  第三次幾乎一模一樣的複製貼上。把這段邏輯收進
  `BlenderClient.convert_or_raise()`（`blender_client.py`），三個
  router 現在都只呼叫這一個方法。這不是為了重構而重構——是在新增第
  三個重複實例的當下做的整併，也是使用者這次「錯誤格式跟前兩個
  endpoint 一致，不要另外設計一套」這句話最直接的落實方式：現在物理
  上只有一套實作，不可能不一致。`jobs_3d.py`／`multiview.py` 原本各自
  的 `_convert_to_usdz()` helper 已刪除。
- `LibraryPage.tsx`：`ModelViewer` 多傳一個 `usdzUrl`，組法跟
  `content_url` 同一個 pattern
  （`resolveApiUrl(\`/api/library/assets/${modelAsset.asset_id}/usdz\`)`）。
  沒有動 `ModelViewer.tsx` 本身或任何 loading/錯誤狀態的邏輯——上一輪
  已經做好、三個呼叫點共用同一份實作，這次純粹是多接一條線。
- 測試：`backend/tests/test_library.py` 新增 4 個測試（成功且第二次
  命中快取、image 型別資產回 400、`BLENDER_EXECUTABLE` 未設定回 503、
  轉檔失敗回 502 且不影響 `/content` 端點）；`test_blender_client.py`
  補 4 個測試涵蓋新的 `convert_or_raise()`（快取命中跳過轉檔、未設定、
  成功、失敗）；`conftest.py` 的 `FakeBlenderClient` 加上
  `convert_or_raise()`，做法跟 `FakeComfyClient` 重新實作
  `ensure_available()` 的既有慣例一致（不是 import 真正的類別）。

## Playwright 視覺驗證：三頁面 × loading/成功/失敗

用 Playwright + `devices['iPhone 13']` 模擬 iOS，對 `ViewerStagePage`
single、multiview 與 `LibraryPage` 三處分別跑了 loading→成功、
loading→失敗兩條路徑，總共 12 張截圖。跟上一輪一樣：跑之前先跟使用者
說明過要做的事（起 dev server、跑無頭瀏覽器）。

**驗證方法**：`App.tsx` 暫時加三個 `/dev-ar-visual/*` route，各自用
真正的 `StageShell`／`library-modal` 容器包一份寫死資料的
`<ModelViewer src=... usdzUrl="/dev-usdz-mock" />`（沒有透過真正的
`WorkspaceContext` 資料流，那個要接真實生成流程才有資料，這次只驗證
AR 按鈕在三種頁面容器樣式下的視覺呈現，資料流本身在前幾輪已經靠
`resolveApiUrl` 建構邏輯 + typecheck + 真實後端 endpoint 測試分開驗證
過）。`/dev-usdz-mock` 這個 fetch 目標用 Playwright 的 `page.route()`
攔截，手動控制回傳成功／502 錯誤。

**過程中踩到兩個環境本身的坑，不是 app 邏輯錯誤，記錄下來避免以後
重踩**：

1. 這個頁面同時跑兩個 WebGL context（three.js 檢查器 + model-viewer
   自己的 canvas），這個 headless 環境渲染負載重到讓 Playwright
   `.click()` 的 actionability 等待（穩定性/動畫檢查）要等好幾秒才
   完成。改用 `dispatchEvent('click')` 跳過那個等待，實測從近 6 秒
   降到 <100ms。
2. 更關鍵的：`page.screenshot()` 本身在這個環境裡也有不可預期的延遲
   ——用時間戳記診斷過，DOM 文字在呼叫 `screenshot()` 的當下已經是
   「USDZ 轉檔中...」，但存下來的 PNG 卻是已經 resolve 完的畫面。
   一開始用「固定延遲時間賭一個安全窗口」的做法（1.5s→5s）都不穩定。
   最終解法：改用 `page.route()` 把請求整個 hold 住（不 fulfill），
   確認畫面文字已經是 loading 狀態、螢幕截圖也連續兩次間隔 500ms
   拍出一模一樣的 bytes（`stableScreenshot()`，代表畫面真的靜止了）
   之後才存檔，然後才手動 `route.fulfill()` 放行——把「畫面到底穩不
   穩」跟「網路請求什麼時候真的完成」兩件事完全解耦，不用再猜時間。

**結果**：三個頁面、loading 與成功／失敗四種截圖都符合預期——
「USDZ 轉檔中...」文字 + `button:disabled` 既有透明度樣式（沒有另外
加任何 CSS）、失敗時 `.hint.error` 紅字訊息、成功後乾淨恢復成
「在 AR 中檢視」，三個頁面（StageShell 面板／StageShell + toggle／
library-modal）的視覺語言完全一致，沒有跟任何既有樣式衝突。

測試完已還原：`App.tsx` 暫時 route/import 已 revert（`git diff` 為
空）、暫時的 `DevArVisualCheck.tsx`／`public/dev-ar-smoke.glb` 已刪除、
`vite` dev server 已關閉。

## 驗證方式與結果

```text
python -m pytest（conda env 3d-asset-platform，Python 3.10.11）
→ 181 passed（上一輪 173 + 這次新增 8 個）

npm run typecheck（tsc -b）
→ exit 0
```

## 已知問題

沿用前幾篇紀錄的已知問題（沒有併發保護、`arScale` 手動縮放、
`BLENDER_CONVERSION_TIMEOUT_SECONDS` 沒用大模型實測、沒有真機
（iPhone/Android）跑過完整 AR 流程）。這次新增：

- Playwright 視覺驗證用的是寫死資料的暫時 route，不是走真正的
  `WorkspaceContext` 資料流；`resolveApiUrl` 組出來的 URL 格式本身
  沒有在瀏覽器裡對著真的 job/asset 資料跑過一次點擊到畫面呈現的完整
  路徑（後端 endpoint 本身已經用真實 Blender 各自測過）。
- `library.py` 的 `require_asset` / `asset_content_path` 沒有另外檢查
  `asset.media_type` 是不是真的 GLB（只檢查 `asset_type != "model"`），
  理論上 `asset_type == "model"` 但檔案不是 `.glb` 的情況（目前
  pipeline 不會產生，但不是型別系統擋住的）會讓 Blender 對著非 GLB
  檔案跑，行為未定義。

## 下一步

- 找一個真實的 job/asset，在瀏覽器裡（不是 Playwright 暫時 route）
  完整走一次「進 Library → 開模型預覽 → 按在 AR 中檢視」確認資料流
  本身沒問題。
- 其餘下一步沿用前幾篇紀錄（真機驗證、npm audit、backend 轉檔耗時
  實測）。
