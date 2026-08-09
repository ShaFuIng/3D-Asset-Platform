# GLB → USDZ 轉檔：Blender headless 轉檔 service

- 日期：2026-08-08
- 負責人：kila606
- 分支：`kila606/ar-model-viewer`
- 相關 Commit：尚未提交

## 本次目標

補上 [2026-08-08-ar-model-viewer-scene-viewer.md](./2026-08-08-ar-model-viewer-scene-viewer.md)
留下的缺口：iOS AR Quick Look 需要 USDZ，Hunyuan3D pipeline 目前只產出
GLB。這次目標是選定轉檔方案、裝好工具、寫一個照既有 `comfy_client.py`
pattern 走的轉檔 service，並用真實 GLB 實測整條路徑確實能跑出可用的
USDZ。**這次沒有新增 API endpoint、沒有把 `ios_src` 接上前端三個呼叫
點**——純粹是轉檔能力本身，範圍內只有這些。

## 完成內容

- 決定用 **Blender 5.2 LTS**（不是使用者最初估的 4.5 LTS，理由見下）
  官方 tarball，解壓在 `~/.local/opt/blender-5.2.0/`，另外建立
  `~/.local/opt/blender -> blender-5.2.0` 這層 symlink，之後要換版本只
  需要重新指一次 symlink，不用改 `.env` 或程式碼。
- 新增 `blender_scripts/glb_to_usdz.py`：在 Blender 內嵌 Python
  （`bpy`）裡執行的轉檔腳本，`bpy.ops.import_scene.gltf` 匯入 → 
  `bpy.ops.wm.usd_export`（`filepath` 結尾是 `.usdz` 時 Blender 會自動
  打包成 USDZ）匯出。
- 新增 `backend/app/services/blender_client.py`：`BlenderClient` 類別，
  跟 `ComfyClient` 同一種寫法——`BlenderClientError` 承接底層失敗、
  `ensure_available()` 包成 `ApiError(503, "blender_unavailable", ...)`
  給需要立即回應的呼叫端用、`convert_glb_to_usdz()` 用
  `asyncio.create_subprocess_exec` 呼叫外部程式（跟 `comfy_client.py`
  用 `httpx.AsyncClient` 呼叫外部 API 是同一個角色，只是換成 subprocess
  版本）。
- `backend/app/config.py` 新增 `blender_executable`（讀
  `BLENDER_EXECUTABLE` 環境變數，比照 `OPENAI_API_KEY` 的作法，沒設定
  時是 `None`、不是寫死路徑）、`blender_conversion_timeout_seconds`
  （讀 `BLENDER_CONVERSION_TIMEOUT_SECONDS`，預設 300 秒）、
  `blender_glb_to_usdz_script_path`（固定指向
  `blender_scripts/glb_to_usdz.py`，這是隨repo走的程式碼，不需要環境
  變數）。兩個新的環境變數都有 dataclass 預設值，不影響
  `backend/tests/conftest.py` 既有 `settings` fixture 的既有欄位。
  `.env.example` 加上對應說明；本機 `.env`（不進 git）填了實際路徑
  `/home/kila/.local/opt/blender/blender`。
- `backend/tests/test_blender_client.py`：9 個新測試，mock
  `asyncio.create_subprocess_exec`，涵蓋沒設定 `BLENDER_EXECUTABLE`、
  輸入檔不存在、成功寫出、非 0 exit code 帶 stderr 訊息、exit 0 但沒
  產出合法 USDZ、逾時、`health()`／`ensure_available()`。

## 設計與實作說明

**為什麼選 Blender 5.2 LTS，不是使用者一開始估的 4.5 LTS**：
查了 developer.blender.org 的 release notes（`pipeline_io` 分頁）：

- 4.5 LTS 的 USD 相關項目主要是 bug fix（FBX→USDZ 缺材質貼圖的
  `export_textures_mode` 修正、USD 骨架動畫因四元數不連續造成的旋轉錯
  誤、`USD: World uses wrong output node`、重複 blend shape 名稱造成
  import crash 等）。
- 5.2 LTS 是後面的版本，**已經內含 4.5 以來所有這些修正**（Blender 的
  發行是線性接續，不是分支特性凍結），另外自己還加了跟這次用途直接
  相關的東西：**USD 匯出／匯入的 color space 支援**（import 時把顏色轉
  成 blend-file 的工作色域、export 時幫 prim 跟貼圖標色彩空間），這對
  glTF 貼圖常見的 sRGB/線性色彩空間搞混（貼圖看起來過暗或死白）是實際
  相關的修正；另外還有匯出時控制 USD 資料 flush 頻率、降低大檔案匯出
  時尖峰記憶體用量的新選項，跟每次都要處理紋理貼圖模型的用途也對得上。
- LTS 支援期：4.5 到 2027-07；5.2 到 2028-07，5.2 多將近一年。

兩邊都指向 5.2：功能上是 4.5 的嚴格超集、多一個直接相關的貼圖色彩正確
性修正、LTS 支援期更長，沒有理由選舊的。

**為什麼是 tarball，不是 `dnf install` 或 Flatpak**：見前一輪已經跟
使用者說明過的理由（`rpm-ostree` atomic 系統沒有 dnf、系統層變更需要
重開機、Flatpak sandbox 會擋 subprocess 存任意路徑），這裡不重複。

**Sandbox vs Host 執行脈絡的確認**（使用者特別點名要查清楚的部分）：
這個開發環境（Claude Code 這一層）本身跑在 Freedesktop SDK Flatpak
sandbox 裡，直接執行指令看到的 `/etc/os-release` 是
`Freedesktop SDK 25.08`；用 `flatpak-spawn --host` 才看得到底層真正的
`Fedora Linux 44.1.7 (Sway Atomic)`。原本擔心：如果這層 sandbox 有存取
限制，之後正式 `uvicorn` backend（跑在 host 上的一般 python process）
呼叫 Blender 的方式可能會跟這裡測試時不一樣，寫錯的話等於留了一個
「本地測試過但正式環境會壞」的坑。

實測結果：把 Blender tarball 解壓在 `~/.local/opt/`（也就是
`/var/home/kila/.local/opt/`，這是一個真正 bind-mount 進 sandbox 的實體
目錄，不是 sandbox 自己的隔離視圖）之後，**直接**執行
`~/.local/opt/blender/blender --version`（不加任何 `flatpak-spawn`
包裝）跟透過 `flatpak-spawn --host` 執行，結果完全一樣、都正常跑。原因
是這個 sandbox 對 `/var/home` 底下的路徑是完整存取，不是 Flatpak app
那種要透過 portal 才能碰檔案的限制沙盒；而且下載回來的 Blender tarball
是完全自帶依賴（bundle 了自己的 `lib/`）的靜態發行版，不依賴 host 特有
的東西。

**結論：`blender_client.py` 裡完全沒有、也不需要任何 `flatpak-spawn`
或其他 sandbox 相關的包裝**，就是單純的 `asyncio.create_subprocess_exec`
直接呼叫 `settings.blender_executable` 這個路徑。這份程式碼在這個
sandbox 裡測試通過的行為，跟未來 host 上的 `uvicorn` process 呼叫時
應該是一致的（今天沒有另外找一台純 host、不透過 Claude Code 的環境
重跑一次來雙重確認，這算是本篇「已知問題」欄位要記的一點）。

**Blender `--python` 腳本錯誤處理的坑**（實測發現，不是憑印象寫的）：
Blender 執行 `--python script.py` 時，如果腳本丟出未被接住的例外，
Blender 只會印出 traceback、**行程本身仍然以 exit code 0 結束**。如果
`blender_client.py` 只看 subprocess 的 return code 判斷成功失敗，遇到
Blender 腳本本身出錯的情況會誤判成功。修法：`glb_to_usdz.py` 自己用
`try/except` 包住主邏輯，失敗時明確呼叫 `sys.exit(1)`——這樣才會真的
反映到 Blender 行程的 exit code 上（有另外驗證過 `sys.exit(1)` 確實會
生效）。`blender_client.py` 那邊除了看 exit code，也另外對輸出檔案做
`_is_valid_usdz()`（檢查 ZIP local-file-header magic bytes）當作第二道
防線，避免哪天腳本邏輯又出現漏接例外的情況。

## 驗證方式與結果

執行（`~/.local/opt/blender/blender --version`）：

```text
Blender 5.2.0 LTS
build date: 2026-07-14
```

真實轉檔測試（用專案裡既有 `storage/models/` 底下兩個測試用 GLB，一個
純幾何、一個帶材質貼圖），直接跑 Blender CLI（不經過 Python service）：

```text
輸入：aaba312a-...glb  → 輸出 out1.usdz，6,263,740 bytes，file(1) 確認
  是合法 Zip archive（method=store，符合 USDZ 要求 entry 不能壓縮）
輸入：d1286b1e-...-textured.glb → 輸出 out2.usdz，5,288,623 bytes，
  用 Python zipfile 檢查內容：out2.usdc（USD 二進位資料）+
  textures/Image_0.png，兩者都是 compress_type=0（STORED），貼圖確實
  有正確帶進去
```

再透過實際的 `BlenderClient.health()` / `convert_glb_to_usdz()`（不是
直接呼叫 CLI，是走這次新增的 service class本身）用
`/home/kila/miniconda3/envs/3d-asset-platform`（Python 3.10.11，這是
`docs/README.md` 記載的已驗證版本，backend 的實際開發環境）重跑一次
textured 那顆模型，成功寫出 5,288,623 bytes 的 USDZ，跟直接 CLI 呼叫
結果一致。

```text
python -m pytest（backend/tests/，Python 3.10.11 conda env）
```

結果：**165 passed**（既有 156 個測試全部通過、新增 9 個
`test_blender_client.py` 測試也全部通過）。`docs/README.md` 記錄的
2026-08-04 基準是「155 passed, 1 skipped」（156 筆）；這次重新確認在
目前 main 上（main 之後又 merge 過其他分支）既有測試已經變成 156
passed、0 skipped，不是這次改動造成的變化——用
`pytest --ignore=tests/test_blender_client.py` 單獨跑過一次確認過
（156 passed），跟加回新檔案後的 156+9=165 對得上。

## 已知問題

- **只在這個 Claude Code sandbox 裡測過，沒有另外找一台不透過 Claude
  Code、純粹的 host shell 重跑一次**來雙重確認 subprocess 呼叫行為完
  全一致。上面「Sandbox vs Host」段落的結論是基於這次觀察到的證據
  （`/var/home` 是完整 bind mount、tarball 自帶依賴），推斷應該一致，
  但不是在兩個完全獨立的 shell 環境各自跑過一次的直接對照。
- 這次**沒有**把 `ios_src` 接上 `ViewerStagePage.tsx` / `LibraryPage.tsx`
  三個呼叫點，也**沒有**新增任何 API endpoint 觸發轉檔（例如 3D job
  完成後自動轉一份 USDZ，或是使用者按「在 AR 中檢視」時即時轉檔）。
  `BlenderClient` 目前完全沒有被 `main.py` 的 `app.state` 或任何
  router 引用，是一個還沒被接線的獨立 service。
- 轉檔目前是同步等待整個 Blender 行程跑完（`await process.communicate()`
  帶 timeout），沒有像 `comfy_client.py` 那樣做輪詢／背景 job 的機制；
  這兩個測試模型轉檔都在 1 秒內完成，但沒測過大型、高多邊形數模型的
  實際耗時，`BLENDER_CONVERSION_TIMEOUT_SECONDS` 預設 300 秒是憑經驗抓
  的數字，沒有實測過真的需要轉多久的模型去驗證這個預設值夠不夠。
- Hunyuan3D 輸出的 GLB 正規化尺度問題，這次轉檔完全沒處理（`usd_export`
  的 `convert_scene_units` / `meters_per_unit` 都用預設值），跟前端那篇
  紀錄提到的手動 `arScale` 是同一個尚未解決的問題，USDZ 產出後大概率
  一樣會有比例不對的狀況。
- 沒有在真實 iPhone 上用 AR Quick Look 開過這次產出的 USDZ 檔案，只驗
  證了「檔案格式合法（Zip、材質貼圖有帶進去）」，沒有驗證「iOS 系統
  真的願意用 AR Quick Look 打開它並正確顯示」。

## 下一步

- 找一台真正獨立於這個開發環境的 host shell，重跑一次
  `blender --version` 跟一次真實轉檔，交叉確認「Sandbox vs Host」那段
  的結論。
- 決定轉檔要用什麼流程接線：3D job 完成後自動背景轉一份、還是使用者
  按「在 AR 中檢視」當下才轉、還是額外開一個
  `POST /api/3d/jobs/{job_id}/usdz`這類 on-demand endpoint；接好後把
  `iosSrc` 傳進 `ModelViewer` 三個呼叫點。
- 把這次產出的其中一個 USDZ 檔案傳到一台 iPhone 上，用 AR Quick Look
  實際打開驗證一次。
- 用一個多邊形數明顯更高的模型測一次轉檔耗時，確認 300 秒的預設
  timeout 是否合理。
