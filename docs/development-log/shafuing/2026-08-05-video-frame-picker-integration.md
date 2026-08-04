# 2026-08-05：Video Frame Picker 整合

- 日期：2026-08-05
- 整合負責人：shafuing
- 原始功能來源：`feat/video-frame-picker`
- 原始作者：kila606
- 整合基底：`feat/game-ui-redesign`
- 整合分支：`feat/integrate-video-frame-picker`

## 本次目標

將 kila606 在 `feat/video-frame-picker` 完成的 Video Frame Picker 手動移植到
目前 Game UI Redesign 基底，讓老師現場可以從影片擷取單張圖片並進入既有
Reference／Single／Multiview 流程。

## 為何沒有直接 merge 舊分支

`feat/video-frame-picker` 是從較舊主線分出的分支，落後於
`feat/game-ui-redesign`。直接 merge 可能把舊版 `App.tsx`、`HomePage.tsx`
與 `styles.css` 帶回目前分支，破壞 Game UI、五階段導覽與 Multiview
OpenAI controls。因此本輪以目前 `feat/game-ui-redesign` 為準，手動移植必要
功能與紀錄。

## 完成內容

- 新增 `/video-upload` route 與 `VideoFramePickerPage.tsx`。
- 影片透過 Object URL 只在瀏覽器本機播放，不上傳完整影片。
- 使用 `<video>` 搭配 `<canvas>` 擷取目前時間點的單張影格。
- Canvas 輸出前將最長邊限制為 2048px，降低常見 4K 手機影片影格超過後端
  上傳限制的風險。
- 影格上傳沿用既有 `POST /api/images/upload`，未新增 API。
- 成功上傳的影格會進入 Asset Library。
- 已上傳影格可透過既有 `WorkspaceContext.importLibraryImageAsReference(...)`
  設為 Reference 並導向 `/reference`。
- 不會自動建立 Single Job 或 Multiview Job；後續生成仍由使用者在既有流程中明確觸發。
- 首頁左欄新增獨立 Video Frame Picker panel，與 Asset Library、Services
  為三個 sibling panels。
- 本輪沒有修改 backend、workflow 或 API contract。

## 原作者歸屬

原始 Video Frame Picker 功能由 kila606 開發，原始紀錄保留於：

- `docs/development-log/kila606/2026-08-04-video-frame-picker.md`

本文件只記錄在 Game UI Redesign 基底上的整合工作。

## 驗證方式與結果

執行：

```text
cd frontend
npm run typecheck
npm run build
```

結果：

- `npm run typecheck` 通過。
- `npm run build` 通過。
- Vite 仍提示既有 chunk size warning，未阻止建置完成。

## 尚需人工驗證

- 使用真實手機拍攝影片在 Chrome、Edge、Safari 等正式瀏覽器中測試。
- MP4、MOV、WebM 等常見格式與實際 codec 的播放相容性。
- 長檔名、多張影格、窄螢幕與手機寬度是否維持無水平捲軸。
- Network 是否只在加入影格時出現 `/api/images/upload`，沒有自動建立
  Single／Multiview Job。
