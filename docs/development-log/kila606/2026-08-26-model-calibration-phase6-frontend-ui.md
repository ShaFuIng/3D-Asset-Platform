# 模型校正 Phase 6：前端 UI

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase6`
- 相關 Commit：尚未提交

## 本次目標

把後端六個 phase（`POST .../calibrate`、`GET .../stl`、
`LibraryAssetResponse` 的 `parent_asset_id`/`calibrated_asset_ids`、
`JobResponse`/`Create3DJobResponse`/`MultiviewModelRef` 的 `asset_id`）
接上真正的 UI：把 `ModelViewer.tsx` 裡那顆「暫時手動調整倍率」的 hack
輸入框換成真正呼叫校正 API 的獨立區塊，讓 `LibraryPage`、
`ViewerStagePage`（single-view + multiview）三個看得到 3D 模型的進入點
都能顯示「已校正／尚未校正」、觸發校正、下載 STL。

## 分支狀態

動手前讀完 Phase 0-5 全部六篇開發紀錄（含 Phase 1），重新確認目前實際
程式碼：這個 branch 完整含 Phase 0-5（`git log` 可見 `ce84f0c` 到
`19d1995` 共 8 個相關 commit），`backend/app/schemas.py` 現狀確認
`Create3DJobResponse`/`JobResponse`/`MultiviewModelRef` 都已有
`asset_id`，`LibraryAssetResponse` 已有 `parent_asset_id`/
`calibrated_asset_ids`——跟前幾輪不同，這次沒有再遇到 branch 內容中途
變化的狀況。

## 現況調查結果

1. **`ModelViewer.tsx` 341-350 行**：重新讀過整份檔案，跟最早那次 AR
   調查時逐字一致，沒有被動過。`arOpen`（78-81 行）只控制
   `<model-viewer>` 元素本身跟「在 AR 中檢視」按鈕的顯示，理由是避免
   一直掛著額外的 3D 渲染引擎——這次校正 UI 移出這個開關，但
   `<model-viewer>` 元素本身維持被 `arOpen` 控制，理由不變。
2. **三個進入點的 `asset_id` 資料流**：`LibraryPage.tsx` 的
   `modelAsset` 天生是 `LibraryAsset` 型別，一旦加上
   `parent_asset_id`/`calibrated_asset_ids` 兩個欄位就不需要額外查詢；
   `ViewerStagePage.tsx` 的 single-view／multiview 兩條路徑目前從沒呼叫
   過 Library API，只打 Job 相關 endpoint，這次是第一次串接。
3. **`api/client.ts` 慣例**：POST/GET 都是薄薄一層包
   `requestJson<T>()`；**檔案下載完全沒有 `client.ts` 先例**——GLB 下載
   是純 `<a href download>` 標籤，USDZ 是 `ModelViewer.tsx` 內部自己
   `fetch()` 塞進 `ios-src` 屬性。STL 這次比照 GLB，純連結，不新增
   client.ts function。

**已確認的設計決定**：`ModelViewer` 維持純 props 驅動，不自己發 API；
三個頁面各自呼叫 `getLibraryAsset()`，但共用同一個
`useAssetCalibration` hook 避免重複程式碼。

## 這次怎麼做

- **`frontend/src/hooks/useAssetCalibration.ts`（新檔案）**：
  `useAssetCalibration(assetId)` 回傳
  `{ rawAsset, calibratedAsset, isLoading, error, refresh }`。查
  raw asset 的 `calibrated_asset_ids[0]`（如果有）再查一次拿它的
  `content_url`。**這裡有一個實作前就先抓到並修正的問題**：第一版
  `refresh()` 的 try/finally 沒有 catch，`getLibraryAsset()` 失敗時
  會變成沒人接住的 promise rejection，`rawAsset`/`calibratedAsset`
  停在 `null`，畫面只會顯示「尚未校正」而不是「查詢失敗」——查詢失敗
  跟「這個 asset 本來就沒校正過」在使用者體感上完全不同，卻會顯示成
  一樣的畫面。修正：加 `error: string | null` state，`catch` 用跟
  `LibraryPage.tsx`/`WorkspaceContext.tsx` 同一套既有的
  `getErrorMessage()` 邏輯轉成字串（不存整個 `Error` 物件），每次
  `refresh()` 開頭清空舊的 error，回傳值加上 `error` 給呼叫端顯示。
- **`api/client.ts`**：新增 `calibrateAsset(assetId, targetMaxDimensionCm)`，
  跟 `trashLibraryAsset` 同一種 `POST` 形狀，帶 JSON body。
- **`types/api.ts`**：`LibraryAsset` 加 `parent_asset_id: string | null`、
  `calibrated_asset_ids: string[]`。
- **`ModelViewer.tsx`**：
  - `ModelViewerProps` 加 `assetId?`、`isCalibrated?`、
    `onCalibrated?: (calibrated: LibraryAsset) => void`。
  - 341-350 行的 `arScale` input 整個拿掉，換成一個不受 `arOpen` 控制、
    `assetId` 存在就顯示的「尺寸校正」區塊：已校正／尚未校正徽章、三個
    預設檔位（小 5cm／中 15cm／大 30cm——這三個數字沒有任何既有慣例可
    抄，是這次自己訂的，抓一般手辦/桌面小物件的常見尺寸區間）+ 自訂
    公分數輸入、「儲存並校正」按鈕（呼叫 `calibrateAsset()`，成功後叫
    `onCalibrated`）、已校正時額外顯示「下載 STL」純連結
    （`resolveApiUrl(\`/api/library/assets/${assetId}/stl\`)`，比照 GLB
    下載的既有慣例，不新增 client.ts function）。
  - AR 面板的 `<model-viewer>`：`scale` 固定 `"1 1 1"`（不再套用任意
    倍率，這個 hack 存在的理由本身這次被拿掉了）；`ar-scale` 只在
    `isCalibrated` 時鎖 `"fixed"`，未校正狀態維持套件預設 `"auto"`，
    讓使用者至少能在 AR session 裡手動調整——這是設計選擇，不是照抄
    既有慣例。
  - `types/model-viewer.d.ts` 補上 `'ar-scale'?: 'auto' | 'fixed'` 型別
    宣告（原本完全沒有這個屬性，不加會 typecheck 失敗）。
- **`LibraryPage.tsx`**：`modelAsset` 那個 modal 呼叫
  `useAssetCalibration(modelAsset?.asset_id)`（限 `asset_type === 'model'`），
  `<ModelViewer>` 的 `src` 改成校正後 asset 存在就顯示它、否則顯示
  raw GLB，並傳 `assetId`/`isCalibrated`/`onCalibrated`；`calibration.error`
  存在時顯示錯誤提示。
- **`ViewerStagePage.tsx`**：`inspectAssetId` 在 `!routed` 這種提早
  return **之前**、單一個 `useAssetCalibration()` 呼叫**之前**就先算好
  （single-view 用 `routed.entry.job?.asset_id`，multiview 用
  `activeModelKind` 決定要 `geometryModel.assetId` 還是
  `texturedModel.assetId`，跟既有 `activeModelUrl` 的 fallback pattern
  一致）——**這是刻意的寫法**：這個元件在多個分支各自有提早
  `return`，hook 不能被包在條件判斷式裡面才呼叫，所以先把
  `assetId` 算成一個變數、`useAssetCalibration()` 在所有提早 return
  之前只呼又一次，確保每次 render 呼叫的 hook 順序一致（React hooks
  規則）。single-view／multiview 兩個分支的 `<ModelViewer>` 都跟著傳
  `assetId`/`isCalibrated`/`onCalibrated`，`src` 一樣優先顯示校正後
  版本。

## 驗證方式與結果

**`npm run typecheck`**（`~/.nvm/versions/node/v20.18.0`）：

```text
> tsc -b
```

無任何輸出，**0 error**。

**`npm run build`**：第一次執行卡在
`Cannot find module '@rolldown/binding-linux-x64-gnu'`——這台機器的
Node（`v20.18.0`）低於 `vite@8.1.5`／`rolldown@1.1.5` 要求的
`^20.19.0 || >=22.12.0`，導致這個平台專屬的原生 binding 套件當初沒被
正確安裝，**這是環境問題，跟這次程式改動無關**（錯誤發生在
`rolldown` 自己 import binding 的階段，還沒碰到任何專案原始碼）。用
`npm install @rolldown/binding-linux-x64-gnu --no-save` 直接補裝這一個
套件（帶 `EBADENGINE` warning，但裝得起來），`--no-save` 確保不會動到
`package.json`/`package-lock.json`（`git status` 確認過沒有）。補裝後
`npm run build` 成功：

```text
tsc -b && vite build
✓ 152 modules transformed.
dist/assets/index-C57R0pRn.js   1,368.68 kB │ gzip: 394.77 kB
✓ built in 335ms
```

只有 Node 版本警告跟既有的 chunk-size warning（`docs/README.md` 記錄
過的既有已知現象，不是這次改動造成的），沒有其他錯誤。這次沒有前端
unit test 框架（repo 既有現狀，`find` 找不到任何 `*.test.*` 檔案），
沒有新增測試。後端這次完全沒有改動，不用跑 `pytest`。

## 已知限制

- 校正檔位的三個公分數（5/15/30）是這次隨手訂的預設值，沒有經過使用者
  驗證。
- `ar-scale` 在未校正狀態下維持 `"auto"` 這個選擇是設計判斷，不是照抄
  既有慣例，如果之後覺得應該一律鎖 `"fixed"` 可以再調整。
- 這台機器的 Node.js 版本（`v20.18.0`）低於 `vite@8.1.5` 官方要求
  （`^20.19.0 || >=22.12.0`），`npm run build` 能跑但每次都會印版本
  警告；長期應該升級這台機器的 Node，而不是每次都靠補裝 binding 繞過去。
- 沒有前端 unit test 覆蓋（repo 既有現狀）。
