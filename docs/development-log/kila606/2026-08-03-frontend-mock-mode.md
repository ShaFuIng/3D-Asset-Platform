# 前端開發用 Mock 模式：離線模擬完整圖片轉 3D Pipeline

- 日期：2026-08-03
- 負責人：kila606
- 分支：`kila606/frontend-mock-mode`
- 相關 Commit：尚未提交

## 本次目標

在不連接真實後端／ComfyUI 的情況下，讓前端也能操作完整的「輸入 Prompt →
生成圖片 → 選圖 → 建立 3D Job → 輪詢狀態 → 顯示 3D 模型」流程，方便日後
在沒有後端環境（例如沒有 GPU、ComfyUI 沒開）時，仍能開發與調整前端介面。
這是一個會持續使用、反覆調整的開發工具，不是一次性測試腳本，因此設計時
以「集中存放、容易修改」為優先考量。

## 完成內容

- 新增一個與 `api/client.ts` 函式簽名完全一致的 mock API 實作，元件端
  （`ImageGallery`、`JobPanel`、`ModelViewer`、`ChatPanel` 等）完全不需要
  修改就能在真實／模擬模式間切換。
- Job 狀態輪詢改為根據「建立時間 + 經過時間」計算目前應該處於
  `queued`／`running`／`succeeded`／`failed` 哪個階段，而不是一問就直接
  回傳完成結果，讓 Loading 等 UI 細節可以被實際測試到。
- 假圖片、假 3D 模型皆在瀏覽器記憶體內即時產生（Canvas 畫圖、
  three.js 自帶的 `GLTFExporter` 現場產生 GLB），不需要另外準備靜態假資源
  檔案，也不會真的打任何網路請求。
- 提供 `VITE_MOCK_MODE` 環境變數作為開關，預設關閉，不影響其他組員。
- 所有假資料與 Mock 邏輯集中放在全新的 `frontend/src/mocks/` 資料夾。

## 主要修改／新增檔案

新增：
- `frontend/src/mocks/config.ts`：總開關與所有可調參數（延遲時間、失敗
  機率、模式），註解說明如何啟用、調整、擴充情境。
- `frontend/src/mocks/mockClient.ts`：7 個 mock API 函式，簽名與
  `api/client.ts` 對齊；內含以經過時間計算的 Job 狀態機。
- `frontend/src/mocks/assets.ts`：純記憶體產生假資源（Canvas 假圖片、
  `GLTFExporter` 現場產生的假 GLB、上傳檔案轉 data URL）。
- `frontend/src/mocks/fixtures.ts`：假聊天回覆文字池。
- `frontend/src/mocks/utils.ts`：`delay()`（支援 `AbortSignal`）、假 id
  產生器。

修改：
- `frontend/src/api/client.ts`：每個匯出函式開頭加一行
  `if (isMockModeEnabled) return mockClient.xxx(...)` 作為切換入口；另外將
  `resolveApiUrl()` 判斷「是否已是完整 URL」的規則，從只認
  `http(s)://` 擴大為任何 URL scheme（含 `data:`／`blob:`），這是讓 Mock
  產生的圖片／模型 URL 能正確顯示所必須的最小調整，其餘既有邏輯未變動。
- `.env.example`：新增 `VITE_MOCK_MODE=false` 並附註說明。

未修改：`ImageGallery.tsx`、`JobPanel.tsx`、`ModelViewer.tsx`、
`ChatPanel.tsx` 及其子元件、`SingleImageWorkspace.tsx`、`App.tsx`、
`types/api.ts` 內部邏輯皆維持原樣。

## 操作手冊

### 開啟 Mock 模式

在專案根目錄的 `.env`（複製自 `.env.example`）中設定：

```text
VITE_MOCK_MODE=true
```

Vite 開發伺服器會自動偵測 `.env` 變化並重新啟動，**不需要手動重啟**
`npm run dev`。確認畫面上方的服務狀態列顯示為已連線／已設定，即代表
Mock 模式已生效（此時實際上並未連到任何真實服務）。

### 開啟後可以做什麼、預期行為

可以完整操作單圖轉 3D 工作區：

1. 在對話框輸入 Prompt 並送出，約 1.2 秒後會產生一張假圖片（依 Prompt
   文字產生對應底色的色塊圖）與一句假的助理回覆。
2. 或直接上傳本機圖片，約 0.6 秒後出現在圖片清單中（顯示的就是你上傳的
   原圖）。
3. 選擇圖片後按下建立 3D Job，狀態會依序經過：
   - `queued`（預設停留約 3 秒）
   - `running`（預設停留約 5 秒）
   - 最終進入 `succeeded` 或 `failed`
4. 成功時，Viewer 會顯示一個現場產生的假 3D 模型（環狀結）可供旋轉、
   切換材質模式檢查。
5. **預設約有 15% 的機率會隨機模擬失敗**（`failed` 狀態），用來測試錯誤
   訊息與失敗狀態下的 UI 顯示是否正常，這是刻意設計、非 Bug。

### 調整模擬延遲時間、失敗機率等參數

全部集中在 `frontend/src/mocks/config.ts`：

- `MOCK_DELAYS.networkLatency`：一般 API（健康檢查、Job 查詢）的模擬延遲。
- `MOCK_DELAYS.imageGeneration`：生成圖片的模擬耗時。
- `MOCK_DELAYS.imageUpload`：上傳圖片的模擬耗時。
- `MOCK_DELAYS.jobQueuedDuration`：Job 停留在 `queued` 的時間。
- `MOCK_DELAYS.jobRunningDuration`：Job 停留在 `running` 的時間。
- `MOCK_JOB_OUTCOME_MODE`：`'random'`（預設，依機率隨機）／
  `'always-fail'`（固定失敗，方便專門測試失敗 UI）／
  `'always-succeed'`（固定成功，方便穩定 Demo）。
- `MOCK_JOB_FAILURE_RATE`：`MOCK_JOB_OUTCOME_MODE` 為 `'random'` 時的失敗
  機率，預設 `0.15`。

修改後儲存即可，Vite 會自動熱更新，不需要重啟。

### 新增新的模擬情境

- 若要新增新的失敗判斷邏輯（例如針對特定圖片模擬失敗），在
  `mockClient.ts` 的 `mockCreate3DJob()` 裡，於呼叫 `resolveJobOutcome()`
  之前，依 `imageId` 或其他條件加上自訂分支即可。
- 若要新增新的假聊天回覆，直接在 `fixtures.ts` 的
  `MOCK_ASSISTANT_REPLIES` 陣列裡加字串。
- 若要換一個假 3D 模型的形狀，改 `assets.ts` 裡 `getMockModelUrl()` 使用
  的 three.js geometry（目前是 `TorusKnotGeometry`）即可。

### 用完怎麼切回真實模式

將 `.env` 裡的設定改回：

```text
VITE_MOCK_MODE=false
```

Vite 會自動偵測 `.env` 變化並重新啟動開發伺服器，同樣**不需要手動重啟**
`npm run dev`，之後前端就會照原本方式呼叫真實後端 API。

## 驗證方式與結果

執行：手動於瀏覽器操作前端（`VITE_MOCK_MODE=true`），完整跑過一輪：

```text
輸入 Prompt → 生成假圖片 → 選圖 → 建立 3D Job
→ 輪詢 queued/running/succeeded → 顯示假模型
```

另外執行：

```text
tsc -b            # typecheck
vite build         # 正式建置
```

結果：通過。畫面與瀏覽器 Console 皆正常，未觀察到型別錯誤、建置錯誤或
執行期例外。

## 已知限制

- 假資料（圖片、3D 模型）為隨機／固定樣式產生，不代表真實 OpenAI 圖片生成
  或 ComfyUI 3D 生成的品質與細節，僅用於驗證前端流程與 UI 狀態切換。
- Mock 模式僅影響前端本機執行環境，純粹在瀏覽器記憶體內模擬，不會呼叫、
  也不會影響任何真實後端或 ComfyUI 服務的狀態。
- Job 狀態機以「建立時間 + 經過時間」計算，只存在於瀏覽器記憶體中，重新
  整理頁面會遺失進行中的模擬 Job 狀態（與真實後端行為不同，真實後端有
  自己的 Job Store）。
- 目前僅涵蓋單圖轉 3D 工作區（`SingleImageWorkspace`）會用到的 API；
  三視圖頁面（`ThreeViewPage`）本身尚未串接任何 API，故不受影響。

## 下一步

- 若三視圖頁面未來串接 API，需要視情況擴充對應的 mock 函式。
- 可視需要加入更多假聊天回覆或假圖片樣式，增加開發時的視覺變化。
