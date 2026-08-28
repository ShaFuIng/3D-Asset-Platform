# Stage 01 加入「從資產庫選取現有圖片」入口

- 日期：2026-08-27
- 負責人：kila606
- 分支：`kila606/library-image-picker`
- 相關 Commit：尚未提交

## 本次目標

`ReferenceStagePage.tsx`（single-view／multiview 共用的圖片選取入口）的
`images` 只是 `WorkspaceContext.tsx` 的 session 內 state，只累積這次瀏覽器
連線期間生成/上傳的圖片，過去上傳過的照片或之前生成過的參考圖，只要不是這次
連線期間新增的，在 Stage 01 完全選不到。這次要在 Stage 01 本身加一個「瀏覽
資產庫並選圖」的入口，選定後直接接上現有 single-view/multiview 流程，範圍
明確排除「使用者直接指定 front/left/back 三張圖、跳過 Qwen 生成」這個更大的
功能（`CreateMultiviewJobRequest` 目前只吃一個 `reference_image_id`，這是
另一個獨立的功能，這次不做）。

這次任務先在 plan mode 下實際讀過程式碼調查四個問題（`ImageAsset`/
`LibraryAsset` 型別落差、`GET /api/library/assets` 行為、`LibraryPage.tsx`
元件可否直接重用、`selectImage()`/`uploadImage()` 選定後的下游行為），計畫
經使用者確認後才開始動手，過程完全沒有修改任何檔案。

## 開始前重新調查發現的落差

計畫階段的調查發現一個重點，讓這次任務的實際範圍比原本預期小：**反方向的
「資產庫圖片 → 設為 Reference」流程其實已經存在**，在
`frontend/src/pages/LibraryPage.tsx` 的 `importAsReference()`（image 型
asset 卡片上的「設為 Reference 並前往調整」按鈕），呼叫的是
`WorkspaceContext.tsx` 既有的 `importLibraryImageAsReference()`（去重＋
prepend 進 `images`＋設定 `selectedImageId`，`VideoFramePickerPage.tsx` 也是
用同一個方法把截取的影片幀送進工作區）。這代表核心的「資產庫資產 →
`ImageAsset` → 進 `images` 狀態」這條資料流已經被驗證過在跑，這次真正缺的只是
「Stage 01 本身有沒有一個進得去資產庫瀏覽的入口」。

另外也確認了：`GET /api/library/assets` 已經支援 `type=image` 篩選、預設排除
垃圾桶（`state=active`）、每筆回傳的 `content_url` 可以直接顯示，資料層完全
不需要新 endpoint。`LibraryPage.tsx` 的 `ImageAssetCard`／分頁邏輯則因為跟
trash/restore/delete、`runMutation()`、workspace side effect 綁在一起，
確認不適合直接搬過來，改成用同一套 `GET /api/library/assets` + 既有
`.asset-grid`/`.asset-card`/`.library-modal` CSS 語彙重新做一個範圍窄很多的
選圖元件。

## 完成內容

- 新增 `frontend/src/components/LibraryImagePicker.tsx`：Stage 01 用的資產庫
  選圖 modal。內部呼叫 `getLibraryAssets({ type: 'image', page, page_size: 24 })`
  （沿用 `LibraryPage.tsx` 的 `AbortController` + 請求序號守衛寫法防止過期
  回應覆蓋新回應），只列出 `asset_type === 'image'` 且未在垃圾桶的資產，
  Previous/Next 分頁，點縮圖即選取並回呼 `onSelect`。視覺上重用
  `.library-modal`/`.library-modal-content`/`.asset-grid`/`.asset-card`/
  `.asset-preview-button`/`.library-pagination`/`.lightbox-close` 這幾個
  `LibraryPage.tsx` 既有的 class，沒有新增任何 CSS。
- 新增 `frontend/src/utils/libraryAsset.ts`（`frontend/src/utils/` 原本不存在，
  這次新建；比照 `hooks/`／`navigation/` 這兩個既有的單檔案目錄慣例，單純
  named export，沒有 index 檔）：把 `toWorkspaceImageSource()`／
  `libraryAssetToImageAsset()` 放在這個獨立檔案裡（第一版落地時暫時放在
  `LibraryImagePicker.tsx` 裡匯出，`LibraryPage.tsx` 反過來 import 它，這次
  依照最初計畫搬回獨立檔案）。`LibraryImagePicker.tsx` 跟 `LibraryPage.tsx`
  現在都從 `../utils/libraryAsset` import，兩邊互相都不 import 對方。


- `frontend/src/components/chat/ChatComposer.tsx`／`ChatPanel.tsx`：既有
  「上傳圖片」旁邊新增「從資產庫選擇圖片」按鈕，透過新的 `onOpenLibraryPicker`
  prop 往上傳遞（跟既有 `onUpload` 的傳遞方式一致）。
- `frontend/src/pages/ReferenceStagePage.tsx`：新增 `isLibraryPickerOpen`
  本地 state（純頁面 UI 狀態，不進 `WorkspaceContext`），按鈕點擊開啟
  `LibraryImagePicker`；選定圖片後呼叫既有的 `importLibraryImageAsReference()`
  並關閉 modal——**不 `navigate()`**，因為已經在 `/reference`，這是跟
  `LibraryPage.tsx` 的 `importAsReference()` 唯一的行為差異。
- `frontend/src/pages/LibraryPage.tsx`：`importAsReference()` 改用
  `LibraryImagePicker.tsx` 匯出的 `libraryAssetToImageAsset()`，移除本地重複
  的 `toWorkspaceImageSource()`。

## 主要修改檔案

- `frontend/src/components/LibraryImagePicker.tsx`（新增）
- `frontend/src/utils/libraryAsset.ts`（新增）
- `frontend/src/components/chat/ChatComposer.tsx`
- `frontend/src/components/chat/ChatPanel.tsx`
- `frontend/src/pages/ReferenceStagePage.tsx`
- `frontend/src/pages/LibraryPage.tsx`
- `backend/` 完全未修改

## 設計與實作說明

**為何用 modal 而非額外分頁籤或合併進 `ImageGallery`**：跟使用者確認過，選擇
彈出式選取視窗——不改動 `ImageGallery` 本身的資料模型（它目前是純 session
state，沒有分頁概念），也不用重新安排整個 `reference-layout` 版面；選定後只有
一筆資產（透過 `importLibraryImageAsReference()`）加進 `images` 最前面，跟
現有「上傳/生成一張圖後出現在圖庫最前面」的行為完全一致。

**為何不重用 `LibraryPage.tsx` 的 `ImageAssetCard`**：`ImageAssetCard` 把
「預覽」「設為 Reference」「移至回收桶」/「恢復」「永久刪除」四種動作和
`isTrash` 分支寫在同一個函式裡，`onTrash`/`onRestore`/`onDelete` 又串到
`runMutation()`，這個函式還會回頭呼叫 `useWorkspace()` 的
`archiveImage`/`restoreImage`/`forgetWorkspaceImage` 同步工作區狀態。這次的
選圖元件只需要「列出圖片、點了就選」這一個動作，硬搬會連帶拉進整套 trash
生命週期與 workspace side effect，因此改成重新寫一個範圍窄很多的元件，只重用
CSS class，不重用元件本身。

**為何沒有新增後端 endpoint**：`GET /api/library/assets` 已經原生支援
`type=image` 篩選、預設排除垃圾桶、回傳可直接顯示的 `content_url`，資料層
不需要動 `backend/` 任何檔案。

**下游相容性**：`ModeSelectPage.tsx`／`GenerateConfirmPage.tsx`／
`MultiviewStagePage.tsx` 只認 `images` 裡有沒有 `image_id === selectedImageId`
這一筆，不區分圖片來源（`pipelineByImageId`/`singleJobsByImageId`/
`multiviewByImageId` 等 map 缺項時都安全地視為「尚未開始」）。
`importLibraryImageAsReference()` 產出的 `ImageAsset` 跟 `uploadImage()`/
`generateImage()` 走的 `addAndSelectImage()` 產出的形狀完全相容，因此這次
沒有動 `selectImage()`、三個下游 stage page，也沒有碰任何 multiview 後端
job 建立邏輯。

## 驗證方式與結果

```text
npm run typecheck（tsc -b）
→ exit 0，無型別錯誤（搬移共用函式之後重跑過一次，同樣 exit 0）

npm run build（tsc -b && vite build）
→ 成功，152 modules transformed，dist 產出正常
  （Node 20.18.0 < vite 建議的 20.19+ 版本警告、chunk size 警告皆為既有環境
  訊息，跟這次改動無關，之前的 dev log 也沒有處理過）
```

**瀏覽器層級驗證（真的跑起來，不是只跑 typecheck/build）**：啟動真實 FastAPI
後端（`uvicorn`，未接 ComfyUI）+ `npm run dev`，用 headless Playwright
（Python，安裝到 `backend/.venv`，只下載 Chromium 執行檔本身，沒有跑
`--with-deps`）自動化整條路徑，斷言逐步列在下方；過程中額外發現一個跟這次
改動無關的環境問題（見下方「開始瀏覽器驗證前發現的問題」）。

**開始瀏覽器驗證前發現的問題（環境問題，不是這次程式碼的 bug）**：本機
`storage/assets.db` 原本的 schema 帶有 `parent_asset_id` 欄位（明顯是先前在
`kila606/model-calibration-phase0` 之後的分支上跑過 migration 留下的檔案，
`storage/assets.db` 本身有 `.gitignore`，不隨分支切換而改變），但這條
`kila606/library-image-picker` 分支是接在 `main` 上，`main` 上的
`AssetRecord`／`asset_catalog.py` 完全不認識這個欄位。結果是：只要有任何一筆
資料被讀回（`_record_from_row()` 把該筆 row 的所有欄位原封不動塞進
`AssetRecord(**...)`），就會丟
`TypeError: AssetRecord.__init__() got an unexpected keyword argument 'parent_asset_id'`，
被 `errors.py` 的 `handle_unexpected_error` 吃掉變成通用 500——`POST
/api/images/upload` 因此每次都回 500（儘管檔案跟 DB row 其實都寫成功了，只是
回傳前的讀回動作炸掉），連帶讓 `GET /api/library/assets` 也會炸。實際確認
原本那個 `assets.db` 裡總共 0 筆資料（不只是 0 筆 image，是完全空的表），所以
沒有真正的資料風險。處理方式：把原檔備份到本機 scratchpad（不在 repo 裡）、
刪除本機的 `storage/assets.db` 讓這個分支的程式碼重新建一個 schema 相符的
空白檔案，驗證跑完後也把測試期間寫入 `storage/images/` 的合成測試圖全部清掉，
確認 `git status`／`storage/images/`／`storage/models/` 都乾淨回到只剩
`.gitkeep`。**沒有改動任何 `backend/` 底下的追蹤檔案**，純粹是本機、
`.gitignore` 掉的資料庫檔案重置，跟這次的功能改動無關；如果你之後要切回
`model-calibration-phase0` 之後的分支，本機的 `storage/assets.db` 屆時會是
（這次重置後的）全新空檔案，不是被我改動過的版本。

**實測步驟與結果**（用 `getLibraryAssets({ type: 'image' })` 真實撈了 26～27
筆合成測試圖片，`page_size=24` 剛好可以測到 2 頁）：

| 步驟 | 預期 | 實際結果 |
| --- | --- | --- |
| 進 `/reference` | Stage 01 正常載入 | ✅ 符合 |
| 「從資產庫選擇圖片」按鈕可見 | 按鈕出現在上傳圖片旁邊 | ✅ 符合 |
| 點擊按鈕 | modal 開啟 | ✅ 符合 |
| modal 內容 | 看到縮圖格線，`.asset-card` 數量 > 0 | ✅ 符合（第一頁 24 張） |
| 分頁指示 | 顯示「Page 1 / 2」 | ✅ 符合 |
| 點 Next | 換成「Page 2 / 2」，內容跟第一頁不同 | ✅ 符合（第一張縮圖 `src` 前後不同） |
| 點回 Previous、選第一頁第一張圖 | modal 關閉 | ✅ 符合 |
| 選定後 | `ImageGallery` 最前面那張卡片 `data-selected="true"` | ✅ 符合 |
| 選定圖片的來源標籤 | 對應該筆資產的 `source`（測試用的是一張 `source: 'uploaded'` 的資產，顯示「上傳圖片」） | ✅ 符合 |
| 「下一步：選擇生成模式 →」 | 選定圖片後從 disabled 變成可點擊 | ✅ 符合 |
| 瀏覽器 console | 全程無 JS 錯誤 | ✅ 符合（`console` `error`/`pageerror` 事件皆為空） |

全部 11 個斷言一次跑過全部通過，沒有出現「modal 沒關」「選取沒反映」「分頁
邏輯有問題」這類跟預期不符的情況，因此這次不需要停下來回報任何未預期行為。
另外用截圖確認過畫面：modal 版面、縮圖格線、選定後 `ImageGallery`／
`action-bar-summary` 的呈現都正確；唯一的視覺瑕疵是這個 headless Chromium
（沒裝系統 CJK 字型）把所有中文字都畫成方塊（tofu），這是這個測試環境本身缺
字型的問題，全站其他既有中文文字在同一組截圖裡也是同樣的方塊，不是這次改動
造成、也不影響裝了正常字型的真實瀏覽器。

這次驗證範圍照計畫排除「選完圖之後真的接 ComfyUI 跑完 single-view/multiview
生成」——那段是既有、已經被證實過的 `importLibraryImageAsReference()` 邏輯，
不是這次新增的風險，這次只驗證「選完圖，`ModeSelectPage` 的下一步按鈕確實
被打開」，沒有再往後跑進實際生成流程。

## 已知問題

- `LibraryImagePicker` 目前假設呼叫者（`ReferenceStagePage.tsx`）在資產庫
  一張圖片都沒有時只顯示空狀態文字，沒有另外導引使用者去上傳；這個情境沒有
  實際畫面確認過樣式是否協調（這次測試環境裡資產庫一直都有圖片，沒有測到空
  清單狀態）。
- 資產庫圖片本來就已經在 `images` 清單裡時（例如剛用資產庫圖片建過
  single-view job，回 Stage 01 又用同一張建 multiview），
  `importLibraryImageAsReference()` 的去重邏輯理論上會生效（不重複 prepend、
  只重新設定 `selectedImageId`），但這次沒有實際操作驗證過這個路徑。
- 本機 `storage/assets.db` 的 schema 落差（見上方說明）是這台機器上、這個
  checkout 目錄的環境狀態問題，不是這次程式碼的 bug，但如果你在其他機器或
  其他 checkout 上也是接續在 model-calibration 分支之後跑過 migration 再切回
  這條 `main` 系分支，理論上會重現同樣的 500——這不是這次任務要處理的範圍，
  這裡只記錄現象，沒有動任何 `backend/` 程式碼去相容兩種 schema。

## 下一步

- 找機會實際串一次真的 ComfyUI（或假的 ComfyUI，比照
  [2026-08-03-image-lightbox-and-job-trigger.md](./2026-08-03-image-lightbox-and-job-trigger.md)
  的驗證方式），從資產庫選圖後一路跑到 single-view/multiview job 完成，確認
  下游生成流程本身也沒有問題（這次刻意沒測這段，見上方驗證範圍說明）。
- 「使用者直接指定 front/left/back 三張圖、跳過 Qwen 生成」是另一個獨立、
  範圍更大的功能（需要後端 `CreateMultiviewJobRequest` 新增多圖輸入的支援），
  這次明確排除在外，之後再另外規劃。
