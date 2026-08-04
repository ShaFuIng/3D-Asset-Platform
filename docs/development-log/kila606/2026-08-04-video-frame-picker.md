# 影片轉多視角素材：Video Frame Picker（獨立於 Multiview 流程之外）

- 日期：2026-08-04
- 負責人：kila606
- 分支：`feat/video-frame-picker`
- 相關 Commit：`40504d1`

## 本次目標

提供一個從影片擷取靜態畫面、加入資產庫的獨立工具，作為現有「對話生成
圖片」「手動上傳圖片」之外的第三種取得圖片來源的方式。硬性限制：完全
不修改 backend、不與 multiview（Qwen 生成、view slot、job 狀態機）任何
環節互動，純粹作為圖片取得工具，取得的圖片跟手動上傳的圖片走同一條路
進資產庫。

## 完成內容

- 新頁面 `VideoFramePickerPage.tsx`，路由 `/video-upload`。
- `<video>` + `<canvas>` 前端擷取畫面，`<input type="range">` 作為
  scrubber，拖動時即時在 canvas 上畫出對應時間點的畫面。
- 「加入此畫面」：`canvas.toBlob()` 截圖，直接呼叫既有的
  `POST /api/images/upload`（沒有新增任何 API），取得 `image_id` 後
  加入本地清單顯示縮圖。
- 清單項目可個別「移除」，純前端操作，不呼叫任何刪除 API（圖片本身
  已經在後端，移除只是從這個頁面的暫存清單拿掉）。
- `HomePage.tsx` 新增「上傳影片」入口卡片，跟既有「開始新資產」卡片
  並排（外層包一層 `.home-entry-row`，原卡片內容與樣式未變動）。
- 版面依照 `MultiviewStagePage`、`ReferenceStagePage` 既有的排版風格
  調整，避免內容集中一側、大片留白。

## 主要修改檔案

- `frontend/src/pages/VideoFramePickerPage.tsx`（新增）
- `frontend/src/App.tsx`
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/styles.css`
- `backend/` 完全未修改

## 設計與實作說明

最初評估過讓使用者選好的幀直接寫入 multiview 系統的 view slot（對應
front/left/back），這樣需要兩件事：（1）某種方式自動判斷每一幀對應
哪個角度，（2）backend 新增一個 endpoint 把已經存在但沒有被任何 router
呼叫的 `multiview_jobs.py` 裡的 `set_candidate()` 暴露出來。

角度判斷這條路測試過用 COLMAP 從影片做 SfM 重建、算出每一幀的相對
旋轉角度，兩次用真實影片測試（原始隨手拍一次、改良成「手機固定、
轉動物體」的拍法後再測一次）都失敗，COLMAP 大多數幀無法成功
registered，可能原因是測試物體（寶特瓶）反光且低紋理、圓柱體本身
特徵點自相似度高，也不排除鏡頭穩定度仍有影響。

考量到時間與 backend 需要另外協調（`set_candidate` 這個 endpoint 的
新增不在這次任務範圍內、也不是這邊能單方面決定的事），最終改採完全
解耦的設計：影片只是取得圖片的另一種方式，跟手動上傳圖片一樣進
`POST /api/images/upload`、進同一個由 `assets.db`（SQLite）管理的
資產庫；這些圖片之後要不要被選為某個 view 的參考圖，交給使用者透過
既有、未修改的 Reference／Multiview 流程自己操作。

## 驗證方式與結果

執行：

```text
Playwright headless Chromium 自動化流程：
首頁 → 點擊「上傳影片」→ 載入測試影片 → 拖動 scrubber 兩次（分別
截圖比對，確認擷取到的畫面內容不同，非重複快取）→「加入此畫面」→
確認 POST /api/images/upload 回應 201 → 確認清單出現縮圖 → 重整
/library 頁面確認圖片出現在 Images 分頁 → 比對全程所有網路請求

tsc -b && vite build
```

結果：全部通過。全程請求記錄中沒有任何 `/api/multiview/*` 或
ComfyUI（:8188）請求；唯一出現的 `/api/comfy/health` 為 `App.tsx`
既有的全站服務狀態燈號檢查，載入任何頁面都會觸發，與此功能無關。
`tsc -b && vite build` 無型別錯誤。

## 已知問題

- 本機（Fedora Atomic）環境的 Firefox 缺 H.264/HEVC 解碼器（系統層
  授權限制），無法直接播放手機拍攝的原始影片做人工測試；改用 ffmpeg
  轉檔成縮小版 WebM 測試 UI 互動。這只影響本機測試體驗，不影響實際
  部署後的使用者（Android Chrome、iOS Safari 原生支援這些格式）。
- 尚未有人用真實手機拍攝的影片、在正式瀏覽器（非 Playwright）中完整
  手動操作過一次；目前只有 Playwright 自動化流程與本機 WebM 手動測試
  兩種驗證，都不是「手機拍、手機或桌面瀏覽器直接播」的原始情境。
- 版面調整是最後一步由 Claude Code 完成，尚未由人工重新截圖確認實際
  呈現效果。
- 本分支從 main 的 `42bd487` 分出，main 目前已經 merge 了
  `feat/multiview-guided-regenerate`（對 `multiview.py`、
  `multiview_jobs.py`、`schemas.py` 等檔案有大量改動），merge 這支
  分支進 main 前需要先 rebase 並確認沒有衝突；本分支僅修改前端 4 個
  檔案、未動 backend，衝突風險評估低，但未實際驗證過。

## 下一步

- 找機會用真實手機在正式瀏覽器上完整測一次。
- Merge 進 main 前先 rebase 到最新 main，確認無衝突。
- 若之後決定要讓 video-picker 產出的圖片直接進 multiview 的 view
  slot（而非目前的「進資產庫、使用者再自行選用」），需要跟 backend
  負責人討論新增暴露 `set_candidate()` 的 endpoint。
