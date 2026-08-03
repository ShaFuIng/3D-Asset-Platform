# 圖片放大檢視、三視圖狀態記憶與 3D Job 觸發位置調整

- 日期：2026-08-03
- 負責人：kila606
- 分支：`kila606/image-lightbox-three-view`
- 相關 Commit：尚未提交

## 本次目標

延續圖片放大檢視（ImageLightbox）功能的開發，把這個功能相關的所有變更
一次完整記錄：放大檢視本身、三視圖生成狀態記憶，以及「建立 3D Job」
觸發位置從 JobPanel 移到 ImageLightbox，方便之後合併與交接時查閱。

## 完成內容

- `ImageGallery` 的圖片卡片新增放大檢視互動：卡片本身「點擊選取」的
  既有行為不變，另外疊加一個放大圖示按鈕，點擊後開啟 `ImageLightbox`。
- `ImageLightbox` 顯示原圖，並排 Side、Back 兩個視圖格（原圖本身即三
  視圖中的正面視圖，因此只需要再生成兩張）。Side、Back 各自有獨立的
  「生成／重新生成」按鈕，可以只重新生成其中一張，不影響另一張已生成
  的內容。視圖內容目前為前端 UI 佔位（假延遲＋文字），尚未接上任何
  真實生成 API。
- 新增「選取視圖」互動：原圖（Front）與已生成的 Side／Back 視圖皆可
  點擊選取，同一時間只能選一張，選取後有清楚的視覺標記（外框變色＋
  「✓ 已選取」文字）；尚未生成的視圖無法被選取。
- 三視圖生成狀態（`ViewGenerationState`）提升到 `SingleImageWorkspace`
  層級管理，以 `image_id` 為 key。使用者關閉放大視窗、切換圖庫選取，
  或重新開啟同一張圖片的放大視窗，先前已生成的視圖狀態都會保留，不需
  要重新生成。
- 「建立 3D Job」的觸發邏輯從 `JobPanel` 移除，改為在 `ImageLightbox`
  內：選取一張視圖後，畫面下方會出現一個明顯較大的「使用 OO 視圖建立
  3D Job」按鈕，點擊後呼叫既有的 `create3DJob`（與先前 `JobPanel` 呼叫
  的方式完全相同，只是把 `image_id` 參數化），並呈現建立中狀態。
- `JobPanel` 改為純狀態呈現元件：不再有「建立 3D Job」按鈕，改為顯示
  「已生成三視圖／尚未生成三視圖」提示、目前選取圖片對應的 Job 狀態、
  ModelViewer 預覽與下載連結。
- Job 狀態（`JobEntry`：`job`、`modelUrl`、`isCreatingJob`、`error`）
  提升到 `SingleImageWorkspace`，同樣以 `image_id` 為 key，讓
  `ImageLightbox`（觸發端）與 `JobPanel`（顯示端）共用同一份資料來源。
  原本針對單一 Job 的輪詢 `useEffect` 已泛化為同時追蹤多個 `image_id`
  各自的 Job 輪詢，沿用同樣的 `setInterval` + `AbortController` +
  cleanup 架構。

## 主要修改檔案

- `frontend/src/components/ImageGallery.tsx`
- `frontend/src/components/ImageLightbox.tsx`
- `frontend/src/components/JobPanel.tsx`
- `frontend/src/pages/SingleImageWorkspace.tsx`
- `frontend/src/styles.css`

## 設計與實作說明

視圖生成狀態原本只提升到 `ImageGallery`（見更早的紀錄）；這一輪因為
`JobPanel`（`ImageGallery` 的手足元件）也需要讀「三視圖是否已生成」與
「Job 狀態」，兩者共同的祖先只有 `SingleImageWorkspace`，因此兩份狀態
最終都提升到這一層，`ImageGallery` 改為純轉發 props，不再自己持有這些
狀態。

目前建立 3D Job 一律只送出「一張」真實圖片的 `image_id` 給後端（後端
`Create3DJobRequest` 本來就只接受單一 `image_id`，這點在稍早的多圖建立
Job 需求調查中已確認過，後端沒有任何多圖相關邏輯，見下方已知問題）。
`ImageLightbox` 的「選取視圖」介面讓使用者可以選 Front／Side／Back 其中
一張來建立 Job，但由於 Side、Back 目前只是前端 UI 佔位（沒有實際生成、
也沒有對應的真實圖片資產），三個選項目前都會解析成同一個真實
`image_id`（也就是原圖本身的 id）。這個開發過程中，原本規劃過「一次用
三張視圖建立一個 Job」的表面互動按鈕，但因後端沒有對應的多圖 API，最終
改為目前這個「選取單一視圖建立 Job」的設計，讓建立 Job 這個動作在目前
的 UI 下就是真的可以動的，而不是掛一個永遠不會被實作的假按鈕。

「slot → image_id」的對應邏輯集中寫在
`frontend/src/components/ImageLightbox.tsx` 的 `handleCreateJobClick()`
函式中，並有註解明確標示：之後如果三視圖生成有了真正的後端支援、
Side／Back 各自產生出獨立的圖片資產，只需要在這個函式裡把對應關係改成
各自對應的真實 `image_id` 即可，不需要更動其他 UI 或狀態管理邏輯。

## 驗證方式與結果

執行：真實 FastAPI 後端（含真實 `create3DJob`／`get3DJob`）搭配一個
本機假 ComfyUI 服務（僅回應 `/system_stats`、`/upload/image`、
`/prompt`、`/history`、`/view` 幾個端點，讓 Job 可以完整跑過
queued → running → succeeded），以 Playwright 驅動瀏覽器完整跑一次：

```text
上傳真實圖片 → 開啟放大檢視 → 確認 Side/Back 未生成前無法選取
→ 選取 Front → 建立 3D Job（呼叫真實 create3DJob）
→ 輪詢至 succeeded → 關閉放大視窗後 JobPanel 顯示同一個 job_id／
狀態／下載連結 → 生成 Side、Back 後 JobPanel 提示變成「已生成三視圖。」
```

另外執行：

```text
tsc -b
vite build
```

結果：通過。畫面與瀏覽器 Console 皆正常，Job 建立與輪詢皆為真實 API
呼叫（非模擬），`JobPanel` 與 `ImageLightbox` 讀取的是同一份共用狀態，
確認資料一致。

## 已知問題

- Side、Back 視圖目前是純 UI 佔位（假延遲＋文字），沒有真實生成內容，
  也沒有獨立的 `image_id`，因此透過放大視圖選取 Side／Back 建立 Job，
  實際上仍是用原圖的 `image_id`（見上方設計說明）。
- 三視圖生成狀態與 Job 狀態都只存在於 `SingleImageWorkspace` 的 React
  State 中，**只在同一次頁面停留期間、於同一個路由（`/`）內切換圖庫
  選取或開關放大視窗時會保留**；一旦透過導覽列切換到「三視圖」頁面
  （`/three-view`）再切回來，或重新整理頁面，`SingleImageWorkspace`
  會整個重新掛載，這些狀態都會被重置。已實際確認 `App.tsx` 的路由
  設定：`SingleImageWorkspace` 是 `/` 路由的 element，並未透過共用
  layout／`Outlet` 跨路由保留，這是目前架構下的既有限制，不是這一輪
  才引入的新問題。
- 目前沒有「一次用三張視圖建立一個 Job」的功能或表面入口；先前規劃過
  的多圖 Job 建立按鈕已在開發過程中被「選取單一視圖建立 Job」取代，
  因為後端本來就不支援多圖 Job（見上方設計說明）。

## 下一步

- 如果之後要做真正的三視圖生成，需要後端提供對應 API，並讓 Side、Back
  各自產生獨立的圖片資產與 `image_id`；屆時可以把
  `ImageLightbox.tsx` 的 `handleCreateJobClick()` 改成依 slot 對應
  各自的真實 `image_id`。
- 若未來真的需要「用多張視圖一次建立 Job」，需要後端新增對應的
  multi-image API（目前 `Create3DJobRequest` 僅有單一 `image_id`
  欄位），前端才有實際可串接的對象。
- 評估是否需要把三視圖生成狀態、Job 狀態改成能跨路由或重新整理頁面
  保留（例如存到 `sessionStorage` 或後端），目前僅存在單次頁面掛載
  期間的 React State 中。