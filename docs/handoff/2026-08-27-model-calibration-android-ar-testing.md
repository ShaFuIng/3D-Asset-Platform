# 模型真實尺寸校正功能 — 手機測試手冊

- 適用對象：ShaFuIng（或任何第一次測試這個功能的人）
- 撰寫人：kila606
- 撰寫日期：2026-08-27
- 目的：不需要另外詢問開發者，就能自己把環境跑起來、用手機實際測完整條路徑

這份文件是操作手冊，不是技術決策紀錄——只講「怎麼做」，不解釋「為什麼
這樣設計」。如果想知道設計理由，可以參考
`docs/development-log/kila606/` 底下對應的開發紀錄，但測試本身不需要
先讀那些。

## 這個功能是什麼

在 Asset Library 跟模型檢視頁面裡，3D 模型現在可以指定一個「真實列印
尺寸」（例如「最長邊 = 15 公分」），系統會依照這個尺寸重新產生一份校正
過的 GLB 模型，並且可以：

- 在手機 AR 模式下用正確比例檢視（原本模型是 AI 生成的，沒有真實世界
  尺度，校正前用手機 AR 看會比例不對）
- 下載對應的 STL 檔案（可以直接拿去 3D 列印）

## 一、前置需求

### 1. 切換到正確的分支

這個功能還沒合併進 `main`，要先切到專用分支：

```powershell
git fetch origin
git checkout kila606/model-calibration-phase6
```

這個分支已經包含這個功能完整的前後端程式碼，不需要再切換或合併其他
分支。

### 2. 手機需求：只支援 Android，iOS 不行

**這次的手機 AR 功能只支援 Android（使用 Google 的 ARCore／Scene
Viewer），iOS（iPhone／iPad）目前完全不支援。** 如果用 iPhone 測試，
「在 AR 中檢視」這個按鈕點下去不會有正確的 AR 效果——這不是壞掉，是
這次功能範圍本來就不含 iOS，測試請務必用 Android 手機。

手機需求：

- 一支 Android 手機
- 已安裝 Google Play 服務裡的「ARCore」（大部分近幾年的 Android 手機
  預設就有，開啟 Chrome 瀏覽器測試時如果缺少，系統通常會自動提示安裝）
- 手機瀏覽器用 Chrome

### 3. 手機安裝 Tailscale，加入同一個 Tailnet

手機跟你平常開發用的電腦要能直接連到彼此，這次測試沿用專案既有的
Tailscale Serve 做法（不是重新發明的新方法，細節見下面第三節）：

1. 手機上安裝 Tailscale App（App Store／Play 商店都找得到）
2. 用跟電腦端相同的帳號登入，加入同一個 Tailnet
3. 確認手機在 Tailscale App 裡看得到你的電腦裝置

## 二、把開發環境跑起來

照專案既有的
[`docs/README.md`](../README.md) 團隊安裝方式操作，這裡只列出最少必要
步驟（完整版本、疑難排解請看那份文件）：

### 1. 安裝相依套件（只有第一次或套件有更新時需要）

```powershell
cd frontend
npm ci
cd ../backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
deactivate
cd ..
```

### 2. 設定 `.env`

```powershell
Copy-Item .env.example .env
```

先不用改內容，等到第三節設定 Tailscale 的時候會再回來改兩行。

### 3. 依序啟動三個服務（建議各自開一個 PowerShell 視窗）

**視窗 1：ComfyUI**——依你自己平常的方式啟動，確認
`http://127.0.0.1:8188` 可以打開。

**視窗 2：後端 FastAPI**：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**視窗 3：前端 Vite**：

```powershell
cd frontend
npm run dev
```

啟動後可以先在電腦上用瀏覽器打開 `http://127.0.0.1:5173` 確認畫面正常
（Asset Library、生成頁面都能開），再繼續下一節設定手機連線。

## 三、讓手機連得到（Tailscale Serve）

這段完全沿用專案既有做法，細節可以參考
[`2026-08-10-android-ar-tailscale-serve.md`](../development-log/kila606/2026-08-10-android-ar-tailscale-serve.md)，
這裡只列操作步驟：

### 1. 修改根目錄 `.env`

打開專案根目錄的 `.env`（不是 `frontend/.env`），改這兩行：

```dotenv
VITE_API_BASE_URL=
VITE_ALLOWED_HOSTS=你的電腦的Tailscale網址
```

`你的電腦的Tailscale網址` 長得像 `your-device.your-tailnet.ts.net`，
可以用下面指令查到：

```powershell
tailscale status
```

改完 `.env` 之後，回到「視窗 3」把 Vite 停掉（`Ctrl + C`）再用
`npm run dev` 重新啟動一次，讓它讀到新的 `.env`。

### 2. 確認手機連得到電腦

```powershell
tailscale ping 你的手機的Tailscale名稱
```

看到有回應（不是逾時）就代表電腦跟手機在同一個 Tailnet 上互相看得到。

### 3. 啟動 Tailscale Serve

```powershell
tailscale serve --bg http://127.0.0.1:5173
tailscale serve status
```

`tailscale serve status` 印出來的網址（`https://xxx.ts.net/`）就是等一下
要在手機上打開的網址。

### 4. 在手機上打開網址

用手機的 **Chrome** 瀏覽器（不要用其他瀏覽器 App）打開上一步印出來的
`https://...ts.net/` 網址，應該會看到跟電腦上一樣的首頁。

測試結束後，記得在電腦上關閉 Serve：

```powershell
tailscale serve --https=443 off
```

## 四、實際測試步驟

### 1. 找一個 3D 模型（兩種方式擇一）

**方式 A（比較快，如果 Library 裡已經有現成模型）：**

1. 在手機瀏覽器打開的頁面上，找到「資產庫」（Asset Library）連結並點進去
2. 切到「Models」分頁
3. 找一個狀態顯示「available」的模型卡片，點「預覽模型」

**方式 B（如果 Library 裡還沒有模型，要自己生成一個）：**

1. 回到首頁，選擇上傳一張圖片或用文字生成一張參考圖
2. 選擇 Single 或 Multiview 其中一種模式，依畫面指示走到「建立 3D
   模型」那一步
3. 等模型生成完成後，頁面會自動進入「模型預覽」頁面

不管哪一種方式，最後都會看到一個 3D 模型檢視畫面（可以用手指拖曳
旋轉、縮放）。

### 2. 打開校正面板、設定尺寸、儲存

在模型檢視畫面裡，往下捲動可以看到一個標示著「尚未校正」的區塊，裡面有：

- 三個尺寸按鈕：**小（5cm）**、**中（15cm）**、**大（30cm）**
- 一個可以自己輸入公分數的欄位（標示「自訂最長邊（公分）」）
- 一個「儲存並校正」按鈕

操作方式：

1. 點選一個尺寸按鈕（例如「中（15cm）」），或直接在自訂欄位輸入你要的
   公分數
2. 點「儲存並校正」
3. 按鈕文字會先變成「校正中...」，處理需要幾秒鐘

### 3. 確認校正成功

校正完成後，原本「尚未校正」的徽章文字會變成「**已校正**」，且畫面上
的 3D 模型應該會重新載入一次（顯示的是校正後的版本）。如果徽章文字
沒有變成「已校正」、或畫面上出現紅字錯誤訊息，代表校正失敗，這時候
不要繼續下一步，先確認後端（視窗 2）有沒有印出錯誤訊息。

### 4. 進入手機 AR 模式，確認尺寸看起來合理

1. 在同一個畫面上找到「在 AR 中檢視」按鈕並點下去
2. 手機應該會呼叫 Google 的 Scene Viewer，用手機鏡頭對準一個平面
   （桌面、地板都可以）
3. 模型放置到畫面上之後，用「你剛剛設定的公分數」當作合理性判斷基準
   ——例如你設定 15 公分，模型放在桌上看起來大概就應該是一個手掌大小
   左右的物件，不會誇張地跟房間一樣大、或小到看不見
4. 這個「看起來合不合理」目前是用肉眼比對，不是用尺量到毫米級別的
   精準驗證，重點是排除「明顯比例跑掉」這種問題

### 5. 下載 STL 檔案

已經校正成功的模型，同一個校正區塊裡會多一個「下載 STL」連結，點下去
瀏覽器會直接下載這個檔案（副檔名 `.stl`）。這個檔案理論上可以直接匯入
3D 印表機的切片軟體，但這份手冊不含「拿去真的印出來」這一步的驗證，
如果方便可以自己額外試試看。

## 五、已知限制

- **iOS 完全不支援**——這次的手機 AR 只做 Android（Google Scene
  Viewer／ARCore），iPhone/iPad 測試沒有意義。
- **三個預設尺寸（小 5cm／中 15cm／大 30cm）是暫定值**，還沒有經過
  正式確認，之後可能會調整。
- **這個功能還沒合併進 `main`**，目前只存在於
  `kila606/model-calibration-phase6` 這個分支，測試完的回饋會決定它
  什麼時候、用什麼形式進到 `main`。
- AR 畫面裡「尺寸看起來合不合理」目前只能用肉眼比對，還沒有更精確的
  真機量測驗證方式。
