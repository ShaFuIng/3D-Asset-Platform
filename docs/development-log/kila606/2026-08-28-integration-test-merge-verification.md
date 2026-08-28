# 合併驗證：`multiview-openai-initial-gen` × `library-image-picker`（disposable `integration-test` 分支）

- 日期：2026-08-28
- 負責人：kila606
- 分支：`integration-test`（從 `kila606/multiview-openai-initial-gen` 開出，merge `kila606/library-image-picker`；**disposable，未 commit**）
- 相關 Commit：無（本次全程未執行 `git commit`／`push`／`rebase`／`reset --hard`／`cherry-pick`／`tag`，`integration-test` 分支目前停在「merge 完成、尚未 commit」的狀態，留給 Lin review 後手動 commit 或捨棄）

## 背景

延續上一個 session 遺留的兩個開放問題（見
`2026-08-28-multiview-openai-initial-gen.md`、
`2026-08-28-vite-port-drift-tailscale-serve.md`），這個 session 的任務是把
`kila606/multiview-openai-initial-gen`（多視角 OpenAI 平行路徑）跟
`kila606/library-image-picker`（Stage 01 資產庫選圖）合併測試，確認兩邊互不衝突，
並在合併後的狀態上做一次端到端功能驗證。開始合併前先處理三個環境相關的開放問題。

## Step 0：開放問題釐清

### 1. 哪個 Python 環境才是 backend 的正確環境

比對結果：**`backend/.venv` 才是文件記載、正確使用的環境**，理由：

- `docs/README.md`「安裝後端」章節明確指示 `python -m venv .venv` +
  `pip install -r requirements.txt`，啟動流程也是 `.\.venv\Scripts\Activate.ps1`
  之後才跑 `uvicorn`——`.venv` 是專案文件唯一記載的方式。
- `backend/.venv/bin/pip freeze` 跟 `backend/requirements.txt` 完全對得上（差異只有
  大小寫跟 `uvicorn[standard]` 這種 extras 語法差異，不是真的缺套件或版本不符）。
- conda 環境 `3d-asset-platform`（`/home/kila/miniconda3/envs/3d-asset-platform`）**不在
  任何專案文件裡**，是今天稍早一個背景 session（PID 6302/6307）為了跑 backend 臨時建立的，
  雖然裝的套件版本剛好跟 `.venv` 一致，但它不是文件記載、team 共用的環境，不應該被當成
  authoritative 環境繼續使用。

結論：後續所有 backend 啟動一律用 `backend/.venv`，不用 conda `3d-asset-platform`。

### 2. 今早遺留的 backend PID 6307

確認時 PID 6307（`python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1
--port 8000`，**沒有 `--reload`**，在 conda `3d-asset-platform` 環境下啟動，父行程
PID 6302）**仍在跑**，`127.0.0.1:8000` 也確實由它佔用（`ss -tlnp` 對得上 PID）。已執行
`kill 6307`，確認後 `127.0.0.1:8000` 的 LISTEN 條目消失、`curl /api/health` 打不通，父
shell PID 6302 也一併消失，沒有殘留任何用舊環境／沒開 `--reload` 的 backend 行程。

### 3. `kila606/library-image-picker` 的 commit 紀錄核實

```
$ git log --format='%H %ci %an %s' main..kila606/library-image-picker
90d7d8b24fa4dae5e3a10429c010e071915db500 2026-08-27 23:16:04 +0800 kila606 feat(frontend): add library image picker to Stage 01

$ git rev-list --count main..kila606/library-image-picker
1
```

**這個分支目前只有一個 commit 領先 `main`**，就是 `90d7d8b`（Stage 01 資產庫選圖功能，
只動了 7 個檔案：新的 dev-log、`LibraryImagePicker.tsx`、`libraryAsset.ts`、
`ChatComposer.tsx`／`ChatPanel.tsx`／`LibraryPage.tsx`／`ReferenceStagePage.tsx`）。

**「隔離 `.env.example` 移除未用的 `OPENAI_RESPONSE_MODEL` 預設值、修正
`workflows/多角度3D生成_API.json` 的 Hunyuan3D 檔名 typo」這第二個 commit
在這個分支上不存在**：

```
$ git diff main kila606/library-image-picker -- .env.example
（無輸出）
$ git diff main kila606/library-image-picker -- 'workflows/多角度3D生成_API.json'
（無輸出）
```

兩個檔案跟 `main` 完全沒有差異。這兩項修正實際上是在
`kila606/multiview-openai-initial-gen` 分支的 commit `43359aa`（`chore(config): drop
unused OPENAI_RESPONSE_MODEL default, fix Hunyuan3D model filename in multiview
workflow`），不在 `library-image-picker` 上——如果之前的印象是「兩個分支都有」，
這次核實後確認是記錯了分支。

另外確認 `kila606/library-image-picker` 上的 `README.md` 沒有殘留 VS Code extension
測試留言（`grep -niE "vscode|extension|test comment"` 對該分支的 `README.md` 內容
無匹配）。

## Step 1：合併測試（`integration-test`，未 commit）

```
git checkout kila606/multiview-openai-initial-gen   # 確認已在這個分支
git checkout -b integration-test
git merge kila606/library-image-picker --no-commit --no-ff
```

結果：**`Automatic merge went well; stopped before committing as requested`，零衝突**。
全 repo 掃過 `<<<<<<<`／`=======`／`>>>>>>>` 衝突標記，`git diff --check` 跟
`git status` 也都沒有任何 `UU`／unmerged path，確認不是「表面上沒 conflict 但其實
還有殘留標記」的假陰性。

被合併進來的變更：

```
A  docs/development-log/kila606/2026-08-27-reference-stage-library-picker.md
 M docs/development-log/kila606/README.md      （3-way 自動合併：兩邊各自新增的索引行都保留）
A  frontend/src/components/LibraryImagePicker.tsx
M  frontend/src/components/chat/ChatComposer.tsx
M  frontend/src/components/chat/ChatPanel.tsx
M  frontend/src/pages/LibraryPage.tsx
M  frontend/src/pages/ReferenceStagePage.tsx
A  frontend/src/utils/libraryAsset.ts
```

**`frontend/src/api/client.ts`、`frontend/src/types/api.ts`、
`frontend/src/context/WorkspaceContext.tsx`、`MultiviewStagePage.tsx` 完全沒有出現在
變更清單裡**——不是「衝突後自動解決」，是因為 `library-image-picker` 唯一的那個 commit
（`90d7d8b`）本來就沒有動到這些共用檔案，兩邊分支在這幾個檔案上根本沒有交集，所以
天生不會衝突。

`docs/development-log/kila606/README.md` 是唯一兩邊都改到的檔案：`multiview-openai-
initial-gen` 這邊（工作目錄裡未 commit 的索引更新）加了 3 行，`library-image-picker`
那個 commit 加了 1 行，行號不同、Git 的 3-way merge 直接兩邊都保留，內容核對過，
索引清單完整（10 篇既有 + 這次相關的 4 篇）。

**沒有執行 `git commit`**——`integration-test` 目前停在「merge 完成、變更已
staged、`MERGE_HEAD` 存在」的狀態，交給 Lin 決定要不要 commit。

## Step 2：端到端驗證

### 環境重啟

- 用 `backend/.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1
  --port 8000` 重啟 backend（確認用對環境、有 `--reload`），`/api/health` 回
  `{"status":"connected",...}`。
- 啟動前端時發現**另一個跟這次任務無關的殘留 `vite` 行程**（PID 112076/112077，
  綁在 `127.0.0.1:5173`，來源不明，`ps` 看是這次 session 稍早留下的），導致
  `strictPort: true` 直接讓 `npm run dev` 硬性失敗（`Error: Port 5173 is already in
  use`）——這正好是 `strictPort` 設計上「寧可失敗也不要靜默漂移」的預期行為，不是新
  bug。`kill` 掉舊行程後重跑 `npm run dev`，穩定綁在 `127.0.0.1:5173`，沒有漂移到
  5174/5175。跟 Step 0 第 2 點屬於同一類問題（session 之間的殘留背景行程），這次也一併
  清乾淨。
- 確認 `backend/app/main.py` 的 CORS 設定**完全未變動**：

  ```python
  allow_origins=[
      "http://localhost:5173",
      "http://127.0.0.1:5173",
  ],
  ```

  仍是寫死的兩條白名單，沒有被改成 regex。

### Stage 01：資產庫選圖（Playwright headless 驗證，`backend/.venv` 內建的 Chromium）

流程：`/reference` → 點「從資產庫選擇圖片」→ 彈窗列出真實圖庫資產（企鵝參考圖、
上傳圖等）→ 選一張 → 「下一步：選擇生成模式」按鈕變為可點 → 導到 `/mode` → 選
「多視角」卡片 → 導到 `/views/<image_id>`。全程 console／page 均無錯誤訊息，畫面
截圖確認彈窗、圖庫列表、Reference 圖片預覽都正常渲染。

### Stage 03：Qwen／OpenAI 切換

`/views/<image_id>` 上 `role="radiogroup"[aria-label="初始三視圖生成方式"]` 存在，
內含 2 個 `input[type=radio][name=initial-provider]`，預設選中 Qwen（本機
ComfyUI）。用 Playwright 切到 OpenAI、再切回 Qwen，兩個方向都正確反映在
`checked` 狀態上，無 console 錯誤。

**中途收到 Lin 的指示，改變了這一步的驗證範圍**：原計畫「if feasible 就兩個
provider 都跑一次真的生成」，但 `/api/comfy/health` 回 `connected`、
`/api/openai/health` 回 `configured`，兩邊「看起來」都可以跑；Lin 指出 **Qwen
生成實際上還不能用（Hunyuan3D custom nodes 還沒裝進 ComfyUI 的
`custom_nodes/`）**，這個「connected」很可能只是單純的 reachability ping，不是
workflow 可執行的保證，要我不要真的觸發 Qwen job，並且追查這個健康檢查到底
驗證了什麼。**因此這次到 UI 層級（radiogroup 存在、切換正常、兩邊都顯示為可用）
就停手，沒有真的送出 Front/Left/Back 生成請求，也沒有花 OpenAI API 額度或跑
ComfyUI GPU job。**

### 追查：「Qwen 可用」這個訊號到底驗證了什麼

依 Lin 要求往回查整條鏈路：

```
MultiviewStagePage.tsx:83  isComfyDisconnected = comfy.status !== 'connected'
       ↑
App.tsx:56                  getComfyHealth() 週期性打 GET /api/comfy/health
       ↑
main.py:66-83                @app.get("/api/comfy/health")：呼叫 comfy_client.health()，
                              成功回 {"status": "connected", ...}，
                              ComfyClientError 則回 {"status": "disconnected", ...}
       ↑
comfy_client.py:22-28         ComfyClient.health()：
                              GET {COMFYUI_BASE_URL}/system_stats，timeout=3.0s，
                              任何非 2xx 都拋 ComfyClientError；2xx 就視為健康
```

**結論：這個檢查只驗證「ComfyUI 這個 HTTP server process 有在跑、`/system_stats`
有回應」，完全沒有檢查 Hunyuan3D custom nodes 是否已安裝在
`custom_nodes/`，也沒有檢查多視角用的 workflow JSON 能不能真的被載入／排入
queue。** 而且 `create_multiview_job` 在 `provider="local"` 時的 preflight——
`ComfyClient.ensure_available()`（`comfy_client.py:30-34`）——內部呼叫的也是同一個
`health()`，等於**目前系統裡沒有任何一層會在送出 Qwen job 之前檢查 custom
nodes 是否存在**；如果真的選 Qwen 送出生成請求，preflight 會通過，job 會被排進
ComfyUI 的 queue，直到 ComfyUI 實際執行到缺少的 custom node 節點時才會在
queue 內部失敗——這個失敗目前不會反映在前端的「可用／不可用」判斷上。這證實了
Lin 的懷疑：`comfy.status === 'connected'`（以及因此推導出的「Qwen 可用」）只代表
「server 可連線」，不代表「workflow 真的能跑完」。這是既有健康檢查設計本身的落差，
不是這次合併新引入的問題，記錄下來供 Lin 之後決定要不要加一層更嚴格的 readiness
檢查（例如打 ComfyUI 的 `/object_info` 確認所需節點類型存在）。

## Step 3：兩篇未加入 git 的 dev-log 草稿狀態

```
docs/development-log/kila606/2026-08-27-frontend-api-base-url-tailnet-fix.md   存在，124 行，git status 仍是 ??（untracked，未被這次改動）
docs/development-log/kila606/2026-08-28-comfyui-hunyuan3d-2mv-deployment.md    存在，186 行，git status 仍是 ??（untracked，未被這次改動）
```

兩篇這次都只確認存在、沒有讀取內容以外的操作，沒有 `git add`，狀態跟 session 開始時
一致。

## 目前留下的可執行環境（給 Lin 手動做最終瀏覽器確認用）

- Backend：`backend/.venv` + `--reload`，PID 116723，`127.0.0.1:8000`。
- Frontend：`npm run dev`，PID 116931/116932，穩定綁在 `127.0.0.1:5173`（未漂移）。
- 若要收掉：`kill 116723 116931 116932`（或直接 `pkill -f uvicorn` /
  `pkill -f vite`，但注意 IDE 本身也有其他 `node` 行程，不要用太寬的 pattern）。

## Done criteria 對照

- ✅ 確認 backend 正確環境（`.venv`），並釐清 conda 環境的來源與定位。
- ✅ 確認並清除了未帶 `--reload` 的舊 backend 行程（PID 6307）。
- ✅ 用 `git log` 實際核實 `kila606/library-image-picker` 的 commit 內容，
  確認「第二個 commit」不存在，並找到那兩項修正實際所在的分支／commit。
- ✅ `integration-test` 合併測試：零衝突，全 repo 掃描確認無殘留衝突標記，
  未執行 `git commit`。
- ✅ Backend `--reload` 重啟、frontend 重啟且穩定綁 5173（含清掉一個額外發現的
  殘留 vite 行程）、CORS 設定核實未變動。
- ✅ Stage 01 資產庫選圖：Playwright headless 驗證開啟／列表／選取／導頁全流程無誤。
- ✅ Stage 03 Qwen／OpenAI 切換：UI 層級驗證通過（依 Lin 指示，未觸發真實生成）。
- ✅ 追查並記錄「Qwen 可用」健康檢查訊號的實際涵蓋範圍與落差。
- ✅ 兩篇未加入 git 的 dev-log 草稿確認仍存在、未被改動。

## 下一步

- `integration-test` 分支目前是 merge 完成但未 commit 的狀態，請 Lin review 後決定
  要不要 commit（或直接在 `library-image-picker`／`multiview-openai-initial-gen`
  上重新走一次正式合併流程），這個分支本身是 disposable，不建議直接留著當長期分支。
- ComfyUI 健康檢查目前只驗證 server reachability、不驗證 custom node 是否安裝，
  建議之後補一層更嚴格的 readiness 檢查（例如 `/object_info`），否則 Qwen 路徑在
  custom nodes 裝好之前，UI 會持續誤報「可用」。
- Hunyuan3D custom nodes 尚未安裝進 ComfyUI 的 `custom_nodes/`，這次沒有處理，
  等 Lin 排時間裝好後再實際跑一次 Qwen 生成驗證。
- 真正的雙 provider 端到端生成驗證（花 OpenAI 額度＋跑 ComfyUI GPU job）這次
  依指示跳過，等 Qwen custom nodes 裝好、且 Lin 確認要花費 API 額度時再補做。
