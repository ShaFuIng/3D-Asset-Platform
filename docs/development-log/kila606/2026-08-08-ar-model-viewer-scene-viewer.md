# Level 1 真 AR 模式：`<model-viewer>` 原生 AR（Scene Viewer／Quick Look）

- 日期：2026-08-08
- 負責人：kila606
- 分支：`kila606/ar-model-viewer`
- 相關 Commit：尚未提交

## 本次目標

在既有的 `kila606/ar-preview-demo`（預先算好深度圖 + WebGL shader 的風格化
合成預覽，概念展示用途，未合併 main）之外，新增一條「Level 1 真 AR」路
線：用瀏覽器原生 `<model-viewer>` 的 `ar` 功能，iOS 走 AR Quick Look、
Android 走 Scene Viewer，直接把後端產出的真實 GLB 放進使用者環境。兩條
路線並列存在，互不干擾、互不取代；本次完全未修改 `ar-preview-demo` 分支
的任何邏輯。

## 完成內容

- 前端整合 `@google/model-viewer`（`^4.3.1`），在共用的
  `components/ModelViewer.tsx` 加上「在 AR 中檢視」toggle 按鈕；展開後
  顯示 `<model-viewer ar ar-modes="scene-viewer quick-look" src=... ios-src=...>`。
  因為 `ModelViewer` 元件是 `ViewerStagePage.tsx`（single 與 multiview 各
  一處）跟 `LibraryPage.tsx` 三個呼叫點共用的唯一元件，這次改動讓三處都
  自動拿到 AR 按鈕，不需要個別去改那兩個 page 檔案。
- 加了一個 `arScale` 手動縮放參數（數字輸入框，預設 `1`，餵給
  `<model-viewer>` 的 `scale` 屬性）。Hunyuan3D 輸出的 GLB 是正規化尺
  度、沒有真實世界大小，AR 裡比例目前會不對；這只是先留一個手動調整的
  逃生口，不是完整解法。
- 新增 `src/types/model-viewer.d.ts`：`@google/model-viewer` 沒有附
  React/JSX 型別，手動宣告 `<model-viewer>` intrinsic element。專案
  `@types/react` 版本已經把 JSX intrinsic elements 的擴充位置從全域
  `JSX` namespace改成 `React.JSX`，所以同時宣告 `declare global {
  namespace JSX {...} }` 跟 `declare module 'react' { namespace JSX
  {...} }` 兩份，不用去猜版本切在哪個小版本號。
- 排除 `npm install` 的 `ERESOLVE` 衝突：`@google/model-viewer@4.3.1`
  peer dependency 宣告 `three@^0.183.0`，跟專案現有 `three@^0.185.1`
  對不上；用 `npm install --legacy-peer-deps` 繞過，**沒有**降
  `three` 版本（降版本風險較大，專案其他地方可能已經在用 0.185 的
  API）。

## 主要修改檔案

- `frontend/package.json`（新增 `@google/model-viewer` 依賴）
- `frontend/package-lock.json`（`npm install --legacy-peer-deps` 產生
  的鎖檔更新）
- `frontend/src/components/ModelViewer.tsx`（AR 按鈕、AR 面板、
  `arScale` 狀態與輸入框）
- `frontend/src/styles.css`（`.viewer-ar-panel` 等新樣式，含既有
  「GUI skin」`var(--gui-*)` 的對應覆寫）
- `frontend/src/types/model-viewer.d.ts`（新增）
- `backend/` 完全未修改

## 設計與實作說明

**為什麼放進 `ModelViewer.tsx` 本體、不是各 page 各加一顆按鈕**：三個
呼叫點目前傳的 prop 都只有 `src`（`ViewerStagePage` 兩處、
`LibraryPage` 一處），沒有任何額外邏輯差異，把 AR 面板做成
`ModelViewer` 內部狀態最省 diff，也避免三處各刻一份重複程式碼。

**`ios-src` 目前沒有任何呼叫端傳入**：後端 pipeline（ComfyUI
`SaveGLB` 節點 → `comfy_client.py` 下載 → `storage.py` 存
`{job_id}.glb`）目前只產出 GLB，沒有 USDZ。`iosSrc` prop 保留為
optional，不傳就不渲染 `ios-src` 屬性，iOS AR Quick Look 目前會拿不到
資源、不可用；Android Scene Viewer 只需要 `src`，這次就能用。GLB→USDZ
轉檔評估與後續實作另外開一篇紀錄（`2026-08-08-blender-usdz-conversion.md`），
不合併進這篇。

**AR 按鈕本體**：用 model-viewer 的 `slot="ar-button"` 機制放自己刻的
中文按鈕（取代預設圖示），點擊由 model-viewer 內部接管觸發
`activateAR()`。這顆按鈕只有在 model-viewer 偵測到目前裝置/瀏覽器真的
支援 AR 時才會顯示，桌機無頭瀏覽器測試時不會出現（見下方驗證結果），
這是預期行為不是 bug。

## 驗證方式與結果

執行：

```text
npm install --legacy-peer-deps   → exit 0，@google/model-viewer 確認裝入 node_modules
npm run typecheck（tsc -b）       → exit 0，無錯誤
```

視覺驗證（Playwright 無頭 Chromium，事前有跟使用者說明才動手）：在
`App.tsx` 暫時加一個 `/dev-ar-smoke` route 直接掛
`<ModelViewer src="/dev-ar-smoke.glb" />`（GLB 借用
`storage/models/` 裡既有的測試模型放進 `public/`），起 `npm run dev`
後截圖：

- 既有 three.js viewer（材質模式、格線、旋轉、重設視角、
  Meshes/Vertices/Triangles 統計）畫面與行為完全沒變。
- 「在 AR 中檢視」按鈕乾淨接在下方；點開後顯示 AR 縮放輸入框（預設
  `1`）與 `<model-viewer>` 畫面，模型正常渲染、可拖曳旋轉。
- model-viewer 內建相機圖示（`ar-button` slot）在桌機無頭瀏覽器沒顯示
  ——如上述，AR 不可用時的預期隱藏行為，真機（Android Chrome / iOS
  Safari）才會出現，這次沒有真機驗證。
- Console 只有 4 個 `ERR_CONNECTION_REFUSED`，是 `ServiceStatusPanel`
  對 backend/openai/comfy 健康檢查的請求（該次沒啟動 backend），與這次
  改動無關。

測試完已還原：`App.tsx` 的暫時 route/import 已 revert（`git diff` 為
空）、暫時複製進 `public/` 的 GLB 已刪除、`vite` dev server 已關閉。

結果：通過。最後重跑一次 `npm install --legacy-peer-deps` 與
`npm run typecheck` 在乾淨狀態下確認同樣是 exit 0（見上）。

## 已知問題

- iOS AR Quick Look 目前不可用：沒有 USDZ 轉檔管線，`ios-src` 沒有任何
  呼叫端提供實際 URL。見 `2026-08-08-blender-usdz-conversion.md`。
- `npm install` 過程 npm audit 回報 **1 個 high severity
  vulnerability**，尚未查是哪個套件、也還沒跑 `npm audit fix`。
- AR 功能（Scene Viewer／Quick Look 實際 launch）只在桌機無頭瀏覽器
  驗證過 UI 層面，還沒有人用真實 Android／iOS 裝置手動測過。
- `arScale` 是最粗略的手動調整，沒有任何自動偵測真實世界尺度的邏輯；
  Hunyuan3D 輸出模型的 AR 比例目前仍需使用者自己試。
- 本地 `main` 一開始落後 origin 20 個 commit（此開發環境沒有 GitHub
  SSH publickey），改用匿名 HTTPS 抓取最新 `main` 後才切出這個分支；
  記錄下來避免之後有人疑惑分支起點怎麼來的。

## 下一步

- 完成 GLB→USDZ 轉檔（見另一篇紀錄），把 `iosSrc` 接上三個呼叫點。
- 找真機（至少一台 Android、一台 iOS）跑一次完整 AR 手動驗證。
- 查一下 `npm audit` 那個 high severity 是什麼、評估要不要處理。
- 視覺 polish：目前 AR 面板樣式是照既有 `.viewer-toolbar` 風格刻的最
  小可用版本，還沒有人從設計角度重新看過。
