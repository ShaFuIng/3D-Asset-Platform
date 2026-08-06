# AR 預覽：兩段式深度合成、獨立 AR Studio 工具與可重用的位置控制元件

- 日期：2026-08-06
- 負責人：kila606
- 分支：`kila606/ar-preview-demo`
- 相關 Commit：尚未提交

## 本次目標

把生成好的 3D 模型合成進一張真實拍攝的展示照片裡，做出「模型站在桌上、
會被桌上物品正確遮擋」的 AR 預覽效果，並提供一個獨立工具頁面
（`/ar-studio`）讓使用者從資產庫挑模型、即時調整位置/大小/旋轉/深度，
不需要碰任何既有的 Reference/Multiview/3D Job 五階段流程。

## 完成內容

- `ARPreview.tsx`：兩段式（two-pass）WebGL 合成，靠「模型的單一深度值
  vs. 照片每個像素的深度」做遮擋判斷（細節見下方「技術架構」）。
- `ARPlacementControls.tsx`（新增）：純展示的滑桿元件（位置 X/Y、大小、
  旋轉、深度 + debug checkbox），不持有自己的 state，`ARStudioPage` 與
  `DevARPreviewPage` 共用同一份元件，各自用 `useState` 管理數值。
- `ARStudioPage.tsx`（`/ar-studio`）：資產庫模型清單、AR 預覽、位置控制
  三欄式版面，在常見筆電螢幕（1440×900）下三欄同時可見、不需捲動、
  控制面板不會疊在照片上（實測結果見下方「驗證方式與結果」）。
- `DevARPreviewPage.tsx`（`/dev/ar-preview`，僅 DEV mode）：改成透過
  `?modelUrl=` 直接指定 GLB，重用同一份 `ARPlacementControls`，用來在
  正式串資產庫之前快速測試/校準某一支 GLB。
- `HomePage.tsx` 有「AR Studio」入口卡片（前一輪已完成，這次未變動）。

## 主要修改檔案

- `frontend/src/components/ARPreview.tsx`（這次由使用者本人直接覆蓋，
  Claude Code 這輪未修改此檔案內容）
- `frontend/src/components/ARPlacementControls.tsx`（新增）
- `frontend/src/pages/ARStudioPage.tsx`
- `frontend/src/pages/DevARPreviewPage.tsx`
- `frontend/src/styles.css`（`.ar-studio-*` 三欄版面、`.ar-placement-controls-*`）
- `backend/` 完全未修改

## 設計與實作說明

### 技術架構：兩段式渲染 + 單一深度閾值遮擋

第一段（Pass 1）把 3D 模型單獨渲染進一個帶 `DepthTexture` 的
`WebGLRenderTarget`，拿到模型的顏色貼圖與深度貼圖。第二段（Pass 2）用一
個全螢幕四邊形 + `ShaderMaterial`，逐像素比較「這個模型有沒有蓋住這個
位置」和「照片這個位置本來有多近」，決定最後要顯示模型顏色還是照片
顏色。

決定遮擋的方式，目前**不是**拿模型自己的逐像素深度去跟照片的深度圖比
——而是把整個角色當成站在「單一一個深度值」上（`characterDepth`
prop，0～1，對應 `scene_depth.png` 的灰階刻度）。原因：模型是立體的，
逐像素深度本身就會隨著模型表面起伏連續變化，跟同樣連續變化的單眼深度
圖相減，會讓遮擋邊界變成一條模糊的漸層，而不是沿著寶特瓶邊緣的一刀切
（實際觀感是角色像被「溶解」掉一部分，而不是被物體乾淨地擋住）。把角
色視為單一深度、跟照片深度圖直接比較大小，遮擋邊界才會夠銳利，才會有
「角色確實站在那個物品後面」的視覺說服力。這個取捨也代表深度圖只有
「近/遠」的相對比較功能，不是真的拿來算模型逐像素的精確前後關係。

`characterDepth` 數值越大＝越靠近鏡頭（`scene_depth.png` 的慣例是近＝
亮，所以角色深度值只要比某個像素的灰階值更大，那個像素代表的物體就會
被角色蓋過去；反之角色深度值比灰階值小，角色就被那個物體擋住）。

相機是固定機位（沒有 OrbitControls），因為這是靜態展示照片的合成效
果，不是可以自由環繞的 3D 檢視。

### `ARPreview` 是純受控元件（controlled component）

`ARPreview` 現在不持有任何自己的 placement state，`positionX` /
`positionY` / `size` / `rotationDeg` / `characterDepth` /
`debugOcclusion` 全部是必填 prop，元件本身只畫 canvas，不畫任何滑桿
UI。這是這次改版故意的設計：滑桿要放哪裡、長什麼樣子，交給呼叫端
（`ARStudioPage`、`DevARPreviewPage`）決定，元件保留 `DEFAULT_POSITION_X`
等 5 個常數的 `export`，讓呼叫端有一個單一的初始值來源，不用各自複製
一份魔術數字。

`ARPlacementControls` 對應是純展示、受控的滑桿集合，不持有 state，每
個數值都配一個 `onChange` callback；呼叫端各自用 `useState` 管理六個
值再傳進去。這代表新增第三個呼叫端（假設之後有別的頁面也要放置角色）
只需要重複 `ARStudioPage.tsx` 的模式，不需要複製滑桿本身的程式碼。

### `/ar-studio` 三欄版面與「不能捲動」的驗收標準

這次最主要的版面限制是：使用者選好模型後，在一般筆電螢幕（以
1440×900 驗證）必須同時看到完整的照片合成畫面**和**全部 5 條滑桿 +
debug checkbox，兩者不能互相遮擋，也不能有任何一塊需要捲動頁面才看得
到。

做法是把版面從原本「清單／預覽」兩欄，改成「清單／預覽／控制」三欄
（`.ar-studio-layout` 的 `grid-template-columns`），三欄同高、控制面
板走一般文件流（不是絕對定位疊在 canvas 上）。模型清單這一欄
（`.ar-studio-list-panel`）額外加了 `max-height: calc(100vh - 260px)`
+ `overflow-y: auto`，讓清單本身可以內部捲動，不會因為資產庫模型一多
就把整個頁面撐高、破壞「不捲動」的驗收標準。

## demo-assets/ar-preview/ 目錄

| 檔案 | 用途 | 如何重新產生 |
|---|---|---|
| `scene.png` | AR 展示用的背景照片本體。 | 目前是 `IMG_1867.jpg`，08/05 手動轉換並縮放至 1600×1200（見 `README.txt`）。換照片＝直接換這個檔案，同時要重新產生下面的 `scene_depth.png`。 |
| `scene_depth.png` | 灰階深度圖，`ARPreview.tsx` 拿來跟 `characterDepth` 比較做遮擋判斷。 | 用外部的 DepthAnything V2 環境（`README.txt` 裡稱為「ParkLens」venv，不在這個 repo 裡，這次沒有再去追這支 venv 實際在哪裡/怎麼裝，只能確認輸出的慣例）對 `scene.png` 跑推論產生。**慣例：近＝亮、遠＝暗**（`README.txt` 明確寫「深度慣例為近=亮/遠=暗」），跟 MiDaS 系列常見的反向慣例不同，換照片重新產生深度圖後務必用 `/dev/ar-preview` 的 debug checkbox 實際檢查一次遮擋方向對不對，不要預設慣例不變。 |
| `scene_mask.png` | 舊版（alpha 遮罩）合成法的產物。 | **目前的 `ARPreview.tsx` 已經不使用這個檔案**（元件檔頭註解明確寫「scene_mask.png is no longer used by this component」），現在的遮擋完全靠 shader 裡的深度比較即時算，不需要離線生成的遮罩。連帶地，`scripts/generate_ar_mask.py`（產生這個檔案的腳本）目前在整個 repo 裡沒有任何程式碼呼叫它，是孤兒腳本；沒有必要在正常流程裡執行，除非之後又要走回 alpha 遮罩合成法。 |
| `README.txt` | 一行說明目前 `scene.png`/`scene_depth.png` 的來源與慣例。 | 換照片時記得同步更新這個檔案，避免下一個人誤判深度慣例（例如以為需要 `--invert`）。 |

## `/ar-studio` 與 `/dev/ar-preview` 的差異

| | `/ar-studio` | `/dev/ar-preview` |
|---|---|---|
| 定位 | 正式功能頁，`App.tsx` 一般路由（正式 build 也在）。 | 開發用手動測試頁，`App.tsx` 裡用 `import.meta.env.DEV` 包起來，正式 build 會被 tree-shake 掉，不會出現在產品環境。 |
| 模型來源 | 資產庫（`getLibraryAssets`，只列 `type: 'model', state: 'active'`），使用者用滑鼠點卡片選。 | 網址參數 `?modelUrl=<GLB URL>`，直接指定任意可存取的 GLB URL，不經過資產庫。 |
| 用途 | 給使用者/demo 展示用：選一個已經生成好的模型，看它合成進 AR 照片的樣子，順手調位置。 | 給開發者校準用：在還沒有一個「乾淨」的資產庫模型，或想測試某支特定 GLB（例如 storage/models 底下手動放的檔案）時，繞過資產庫直接測。 |
| 版面 | 三欄式，刻意排版符合「不捲動同時看到照片＋全部滑桿」的驗收標準。 | 單欄堆疊（先照片、後控制面板），沒有特別排版要求，能用、能校準即可。 |
| 共用的部分 | 兩者都是 `ARPreview` + `ARPlacementControls` 的組合，各自用 `useState` 管六個值，初始值都來自 `ARPreview.tsx` export 的 `DEFAULT_*` 常數。 | 同左。 |

## DEFAULT_* 校準數值是針對哪張照片調的

`ARPreview.tsx` 裡的 `DEFAULT_POSITION_X = 1.2`、`DEFAULT_POSITION_Y =
-0.5`、`DEFAULT_SIZE = 1.8`、`DEFAULT_ROTATION_DEG = 25`、
`DEFAULT_CHARACTER_DEPTH = 0.55` 是針對**目前的** `scene.png`（也就是
`README.txt` 裡說的 `IMG_1867.jpg`：桌面场景，寶特瓶在畫面右側偏近
景、筆電在中間、禮物盒在左側偏遠景）調的。這組值讓角色在正常寬螢幕
（例如 `/dev/ar-preview` 單欄版面，寬高比接近 3.7:1）下站在筆電螢幕
前、被寶特瓶正確地部分遮擋。

**換照片之後這五個數字幾乎一定要重調**，流程建議：先把新的
`scene.png`/`scene_depth.png` 放進 `demo-assets/ar-preview/`，用
`/dev/ar-preview?modelUrl=<隨便一支 GLB>` 開著（這頁的預覽欄位是滿版
寬，適合校準），配合 debug checkbox 把 5 個滑桿調到滿意的位置，再把最
終數字回填進 `ARPreview.tsx` 的 `DEFAULT_*` 常數。

## 已知限制

- **預覽容器的長寬比會影響角色在畫面上的位置與可見度，這是這次驗證時
  重新確認過、目前仍然存在的限制**（對應舊版註解提過的「窄螢幕/極端
  長寬比下的對不齊問題」）。原因：相機的垂直 FOV 固定（45°），
  `camera.aspect` 隨容器寬高比即時變動，所以同一個世界座標的
  `positionX` 在不同寬高比的容器裡會投影到畫面上不同的水平位置；同時
  角色的遮擋是用固定的 `characterDepth` 跟照片深度圖比較，並不會因為
  容器變窄而自動調整。實測：`/dev/ar-preview` 在接近滿版寬（寬高比
  ≈3.7:1）的容器下用 DEFAULT_* 校準值可以清楚看到角色站在筆電前；把同
  一個容器硬壓成 `/ar-studio` 三欄版面實際使用的寬高比（≈1.8:1，
  655×360）之後，角色雖然還在、沒有消失，但因為投影位置變化，變得比
  較小、顏色偏暗又跟畫面裡黑色的筆電螢幕重疊，肉眼在正常大小的截圖上
  很容易誤判成「角色不見了」（這次驗證中就發生過一次，後來放大截圖確
  認角色其實還在）。目前沒有讓 `ARPreview` 根據容器寬高比自動修正角色
  投影位置的機制，本質上是一次校準只對一種寬高比準——如果之後要讓
  `/ar-studio` 的預覽欄位寬高比跟校準時用的寬高比不一樣，需要重新用那
  個實際的容器尺寸校準一次 `DEFAULT_*`，或是由熟悉這個 shader/相機模
  型的人設計一個會隨容器寬高比自動補償的版本。
- 滑桿沒有互相限制數值範圍：例如同時把 `positionY` 拉高、`size` 拉到
  最大，角色會被推到畫面外看不到，這是預期行為（滑桿範圍設計就是給使
  用者自由試，不是每個組合都會產生「看起來正常」的畫面），不是 bug，
  但畫面上目前沒有任何提示告訴使用者「角色可能已經跑出可視範圍」。
- 沒有處理模型載入失敗以外的其他錯誤情境的重試機制（例如遮擋深度圖
  404 只會顯示一段文字錯誤，不會自動重試或給出更明確的排除建議）。

## 驗證方式與結果

執行：

```text
tsc -b --force
vite build

Playwright headless Chromium，viewport 1440x900：
1. /ar-studio：點第一張模型卡片 → 量測 .viewer-shell 與
   .ar-placement-controls 的 bounding rect，確認兩者不重疊、
   document.scrollingElement.scrollHeight 沒有超過 window.innerHeight
   （即沒有觸發頁面捲動）→ 確認滑桿數量=5、checkbox 數量=1 →
   依序拖動 5 條滑桿 + 切換 debug checkbox，逐步截圖 →
   把 5 條滑桿都拉回預設值，確認角色回到跟一開始完全相同的位置
2. /dev/ar-preview：確認滑桿數量=5，拖動 positionX 滑桿截圖
3. 全程收集 console 訊息（含 pageerror）
```

結果：

- `tsc -b --force`：**exit 0，通過**。
- `vite build`：通過（`dist/assets/index-*.js` 948.83 kB，跟這次改動
  無關的既有 chunk-size 警告，不影響功能）。
- 版面驗收標準（最重要的那條）：**達成**。
  `hasVerticalScroll: false`，`window.innerHeight` 與
  `document.scrollingElement.scrollHeight` 都是 900、完全相等；
  `.viewer-shell`（照片/canvas）的 bounding rect 右緣在 x≈1059，
  `.ar-placement-controls`（控制面板）左緣在 x≈1117，中間有實際間
  距，未重疊。5 條滑桿、1 個 checkbox 在 `/ar-studio` 與
  `/dev/ar-preview` 都各自找到剛好對應的數量。
- 滑桿即時操控畫面：確認每條滑桿拖動後畫面會重繪（見下方截圖），把 5
  條滑桿都拉回預設值後，角色畫面跟最初載入時逐像素比對是同一個狀態，
  沒有累積漂移的跡象。
- console：**沒有任何 `[error]` 或 `pageerror`**，唯一出現的是這個沙盒
  環境軟體渲染固有的 GPU 驅動訊息（`GPU stall due to ReadPixels`），跟
  這次改動的正確性無關，前幾輪驗證也都會出現。

  ```text
  [debug] [vite] connecting...
  [debug] [vite] connected.
  [info] Download the React DevTools for a better development experience...
  [warning] GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels
  ```

- 截圖存放於 `tmp-review/ar-preview-check/`：
  `arstudio-1440x900-01-initial.png`（三欄版面、預設狀態）、
  `arstudio-1440x900-02-posx.png`／`-03-big.png`／`-04-debug.png`
  （滑桿拖動過程）、`arstudio-1440x900-05-reset.png`（拉回預設值後）、
  `devarpreview-01.png`（`/dev/ar-preview` 拖動 positionX 後）。

## ⚠️ 這次沒有解決、需要你決定的事

`tsc -b` 目前對 `ARStudioPage.tsx`／`DevARPreviewPage.tsx`／
`ARPlacementControls.tsx` 這三個檔案本身**沒有任何錯誤**（上面的驗證
結果就是在這三個檔案都改完之後跑的，全部通過）。但如果連
`ViewerStagePage.tsx` 一起編譯，會多出這兩個既有的錯誤：

```text
src/pages/ViewerStagePage.tsx(82,70): error TS2739: Type '{ modelUrl: string | undefined; }' is missing the following properties from type 'ARPreviewProps': positionX, positionY, size, rotationDeg, characterDepth
src/pages/ViewerStagePage.tsx(167,14): error TS2739: Type '{ modelUrl: string | undefined; }' is missing the following properties from type 'ARPreviewProps': positionX, positionY, size, rotationDeg, characterDepth
```

`ViewerStagePage.tsx` 在主流程（Reference/Multiview 五階段）裡也有兩
處 `<ARPreview modelUrl={...} />`，沒有傳新版必填的 5 個 placement
prop。這是你這次把 `positionX`／`positionY`／`size`／`rotationDeg`／
`characterDepth` 從選填改成必填造成的，跟這次 `ARStudioPage`／
`ARPlacementControls` 的新增改動無關；因為這次的指示明確不要動
`ViewerStagePage.tsx`，這兩處沒有處理，`tsc -b` 目前整個專案編譯還是
會報錯（`vite build` 本身不做嚴格型別檢查，所以 dev server／
production build 實際上還是能跑，只是型別不安全）。需要你決定要幫
`ViewerStagePage.tsx` 這兩處也接上 `ARPlacementControls`（重用同一套
模式），還是幫這兩個呼叫點的 prop 補上暫時的預設值，還是其他做法。

## 下一步

- 決定並處理上面 `ViewerStagePage.tsx` 的 `tsc -b` 錯誤。
- 找機會實測「換一張長寬比明顯不同的展示照片」，確認已知限制段落描述
  的容器寬高比問題重現方式，評估是否值得投入時間做自動補償。
- 目前 `/ar-studio` 沒有處理「模型被滑桿推出畫面外」時的任何提示，可
  以考慮之後加一個簡單的邊界警告或一鍵「回到預設位置」按鈕。
