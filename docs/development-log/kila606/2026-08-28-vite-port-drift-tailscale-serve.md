# Vite 開發伺服器 port 漂移根因：`tailscale serve` 常駐佔用 wildcard bind

- 日期：2026-08-28
- 負責人：kila606
- 分支：`kila606/multiview-openai-initial-gen`（沿用當前分支，未另開分支——理由見下方「為什麼沒開新分支」）
- 相關 Commit：尚未提交（改動留在 working tree，交給 Lin review）

## 背景

這個 session 一開始的任務是「放寬 backend CORS，讓前端不管 Vite 落在
哪個 port 都能用」，但用者後續給了修正指示：**不要碰
`backend/app/main.py` 的 CORS 設定**，改成專心把「Vite 為什麼會漂移
到 5174/5175」這個根因找出來，只有在真的需要程式碼修正時才動手。

因此這篇記錄只涵蓋 port 漂移的診斷過程與最終驗證過的修正，
`backend/app/main.py` 維持原樣（`allow_origins` 仍是寫死的
`http://localhost:5173` / `http://127.0.0.1:5173` 兩條）。

## 為什麼沒開新分支

這個修正（`vite.config.ts` 加 `strictPort: true`）跟目前分支
（`kila606/multiview-openai-initial-gen`）要做的多視角 OpenAI 平行路徑
完全無關，理論上應該分開。但因為：

1. working tree 目前已經混著上一個 session 遺留的 pre-existing WIP
   （見 `2026-08-28-multiview-openai-initial-gen.md` 的插曲章節），
2. 這次改動只有一個 config 檔案，範圍很小、很好單獨挑出來，

所以先照原分支繼續做，把改動記錄清楚，實際要不要拆到獨立分支、要跟
哪些改動一起 commit，留給 Lin 依照 review 時的實際 working tree 狀態
決定。

## 症狀

`lsof -i :5173`、`ss -tlnp | grep 5173` 看起來乾淨，但 Vite 仍然印出

```
Port 5173 is in use, trying another one...
```

然後落在 5174 或 5175。`kill -9`／`fuser -k` 對著確認過的 PID 執行也
沒有解決（因為——如下所述——根本沒有一個「屬於某個 PID、綁在
127.0.0.1:5173」的程序可以殺）。

## 診斷過程

### 1. 分開看 IPv4／IPv6，而不是籠統 grep 5173

```
$ ss -tlnp -4 | grep 5173
LISTEN 0  4096  100.122.205.65:5173   0.0.0.0:*

$ ss -tlnp -6 | grep 5173
LISTEN 0  4096  [fd7a:115c:a1e0::735:cd42]:5173   [::]:*
```

兩條都「沒有 Process 欄位」（正常情況下 ss 對同使用者的程序會顯示
`users:(("name",pid=...))`），而且位址都不是 `127.0.0.1` 或
`0.0.0.0`，是 Tailscale 分配的位址（IPv4 的 `100.122.205.65` 跟
IPv6 的 tailnet 位址）。這就是為什麼單純 `grep 5173` 配合「看起來
沒有熟悉的 127.0.0.1 條目」會被誤判成「乾淨」——它其實一直都在
輸出裡，只是長得不像預期中的衝突來源，容易被略過。

### 2. `localhost` 解析：排除，非本案根因

```
$ getent hosts localhost
::1  localhost          # NSS 回傳 ::1 在前

$ grep localhost /etc/hosts
127.0.0.1  localhost
::1  ip6-localhost ip6-loopback   # 注意：這行的名字其實是 ip6-localhost，不是 localhost

$ node -e "require('dns').lookup('localhost',{all:true},(e,r)=>console.log(e,r))"
null [ { address: '127.0.0.1', family: 4 } ]
```

`getent` 跟 Node 的 `dns.lookup` 對 `localhost` 給出不一致的結果
（前者像是先給 `::1`，後者只給 `127.0.0.1`），本來懷疑會不會是
Node 版本的 `dns.lookup` 預設 `verbatim` 行為讓專案在沒有明確指定
host 時解析到錯的介面。但檢查 `frontend/vite.config.ts` 之後發現
`server.host` 是寫死的 IP 字面值 `'127.0.0.1'`，不是主機名稱
`'localhost'`——Node 對 IP 字面值不會做 DNS 查詢，直接使用，所以這條
路徑**跟本案無關，予以排除**。

### 3. 直接用 socket bind 重現，繞過 Vite

```
$ python3 -c "import socket; s=socket.socket(...); s.bind(('127.0.0.1',5173)); ..."
bound OK on 127.0.0.1:5173          # 綁 127.0.0.1 成功

$ python3 -c "... s.bind(('0.0.0.0',5173)); ..."
BIND FAILED (0.0.0.0): [Errno 98] Address already in use   # 綁 0.0.0.0 失敗！

$ python3 -c "... AF_INET6 ... s.bind(('::',5173)); ..."
BIND FAILED (::): [Errno 98] Address already in use        # 綁 :: 也失敗！
```

關鍵發現：`127.0.0.1:5173` 本身完全乾淨、綁得起來，但 wildcard
（`0.0.0.0` 與 `::`）在這台機器上綁 5173 會直接失敗——因為 Linux
核心不允許在「已經有一個特定位址的 socket 占用某 port」時，再用
wildcard 位址去綁同一個 port（避免語意衝突）。已經有東西綁在
`100.122.205.65:5173` 上，這就是 wildcard bind 失敗的直接原因。

### 4. 是誰綁住 `100.122.205.65:5173`

```
$ tailscale serve status
https://creatorm16hx-1.tailda4ce3.ts.net:5173 (tailnet only)
|-- / proxy http://127.0.0.1:5173
https://creatorm16hx-1.tailda4ce3.ts.net:8000 (tailnet only)
|-- / proxy http://127.0.0.1:8000

$ ps aux | grep tailscaled
root  210  ...  /usr/sbin/tailscaled --state=... --socket=...
```

`tailscale serve`（在 `2026-08-10-android-ar-tailscale-serve.md`
設定的那次）把 tailnet 上的 `:5173` 跟 `:8000` **常駐**反向代理到
`127.0.0.1:5173` / `127.0.0.1:8000`。這個反代由 `tailscaled`（以
root 身分執行）在自己的 userspace netstack 裡處理，會在
tailscale0 介面的位址上開一個真的 LISTEN socket，但因為
`tailscaled` 是 root、而我們是一般使用者 `kila`，`ss`/`lsof` 沒有
權限把這個 socket 對應回 PID，所以只看得到位址跟 port，Process
欄位是空的——這解釋了「看起來像沒有程序占用」的假象。而且這個
listener 是 **tailscale serve 設定本身的常駐狀態**，跟 Vite 進程
生命週期完全無關，不會因為 `kill -9`/`fuser -k` 任何 Vite/node
PID 而消失，這也解釋了「殺了程序還是沒解決」。

### 5. 為什麼這會讓 Vite 誤判——挖 Vite 原始碼證實

`frontend/node_modules/vite/dist/node/chunks/node.js`：

```js
const wildcardHosts = new Set(["0.0.0.0", "::", "0000:...0000"]);

async function isPortAvailable(port) {
  for (const host of wildcardHosts)
    if (!await tryListen(port, host).catch(() => true)) return false;
  return true;
}

async function httpServerStart(httpServer, serverOptions) {
  const { port: startPort, strictPort, host, logger } = serverOptions;
  for (let port = startPort; port <= MAX_PORT; port++) {
    const portAvailableOnWildcard = await isPortAvailable(port);
    if (strictPort) {
      // strictPort 模式：直接綁真正設定的 host，不管 wildcard 探測結果
      ...
    }
    if (portAvailableOnWildcard) {
      const result = await tryBindServer(httpServer, port, host);
      if (result.success) return port;
      ...
    }
    logger.info(`Port ${port} is in use, trying another one...`);   // <-- 就是這行
  }
}
```

**這是問題的完整根因**：這個專案的 `vite.config.ts` 雖然把
`server.host` 釘死成 `'127.0.0.1'`，但 Vite 在非 `strictPort`
模式下（這個專案原本沒設定 `strictPort`，預設是 `false`），
`httpServerStart` 每次選 port 都會**先**對 wildcard 位址
（`0.0.0.0`、`::`）做一次可用性探測，**如果探測失敗，根本不會去
嘗試綁定真正設定的 `127.0.0.1`**，直接印
`Port ${port} is in use, trying another one...` 然後跳下一個
port。因為 `tailscale serve` 常駐占用了 5173 的 wildcard
可用性（見上一步），這個探測每次都會失敗，Vite 因此永遠跳過
5173，即使 `127.0.0.1:5173` 本身完全是空的。

### 6. 排除的假設

- ❌ WSL2 mirrored vs NAT networking mode 差異：`wslinfo
  --networking-mode` 回報 `nat`（非 mirrored），但 NAT 模式本身
  跟這個問題無關——問題不是 WSL↔Windows 之間的轉發，是 WSL 內部
  `tailscaled` 自己的 netstack 綁定行為。
- ❌ Windows 端 `.wslconfig` 的 `localhostForwarding`：這個設定
  管的是 Windows→WSL2 的 127.0.0.1 轉發，跟 WSL 內部
  tailnet 介面上的 bind 衝突無關，予以排除。
- ❌ TIME_WAIT／rapid bind-release 造成的核心層殘留：
  `ss -tan state time-wait | grep 517[3-6]` 完全沒有輸出；而且
  TIME_WAIT 影響的是「已關閉的已建立連線」，不是 LISTEN socket 本身
  ——程序死掉後 LISTEN socket 由核心立即釋放，不會卡在 TIME_WAIT，
  予以排除。
- ❌ 孤兒網路命名空間／WSL vEthernet 殘留：`ip netns list` 沒有
  輸出（沒有額外 netns）；`ip addr` 只看到預期的三個介面
  （`lo`、`eth0`、`tailscale0`），沒有異常的虛擬介面，予以排除。
- ❌ `localhost` DNS 解析順序（`::1` vs `127.0.0.1`）：如第 2 點
  所述，專案已經用 IP 字面值釘死 host，這條路徑不適用，予以排除。
- ✅ 唯一成立、且已經用原始碼+實際重現雙重驗證過的根因：**Vite 非
  strictPort 模式的 wildcard 可用性預檢，撞上 `tailscale serve`
  常駐佔用 5173 的 wildcard bind**。

## 修正

`frontend/vite.config.ts` 的 `server` 設定加一行
`strictPort: true`。原理：`strictPort: true` 會讓
`httpServerStart` 跳過 wildcard 預檢，直接嘗試綁定真正設定的
`127.0.0.1:5173`——反正這個位址本來就是空的，會直接綁定成功；如果
未來 `127.0.0.1:5173` 真的被別的程序占用，會直接丟出錯誤讓你
知道，而不是靜默漂移到別的 port（這正好也符合「plain
`lsof`/`ss` 檢查會漏掉根因」這個 session 想避免的情境——與其讓
它默默換 port、事後很難追，不如讓它直接失敗、錯誤訊息明確）。

### 驗證

啟動 `npm run dev` 後：

```
Port 5173 is in use on a wildcard address, but 127.0.0.1:5173 is available.
There may be another server running on a wildcard IP on port 5173.

  VITE v8.1.5  ready in 179 ms
  ➜  Local:   http://127.0.0.1:5173/
```

Vite 自己印出的警告文字，跟上面第 5 點原始碼分析裡
`strictPort` 分支的那句 `logger.warn(...)` 完全對上，等於是
Vite 自己確認了這個根因分析。而且這次確實穩定綁在 5173，沒有漂移。

接著用 curl 模擬瀏覽器（帶 `Origin: http://127.0.0.1:5173` header，
透過 Vite 的 `/api` proxy）驗證三個 health endpoint：

```
/api/health         → 200, access-control-allow-origin: http://127.0.0.1:5173
/api/comfy/health   → 200, access-control-allow-origin: http://127.0.0.1:5173
/api/openai/health  → 200, access-control-allow-origin: http://127.0.0.1:5173
```

三個都通，且 CORS header 正確——因為現在 Vite 穩定落在 5173，
`backend/app/main.py` 原本寫死的 `allow_origins` 白名單（包含
`http://127.0.0.1:5173`）就已經夠用，不需要放寬成 regex。

**註記**：這個環境沒有真的瀏覽器可以操作，上面的驗證是用 curl
帶 `Origin` header 模擬瀏覽器 fetch 會送出／預期看到的行為，不是
實際點開瀏覽器跑過。建議 Lin 收到這份分支後，實際在瀏覽器開
`http://127.0.0.1:5173`，確認三個 health 狀態列在畫面上真的顯示
connected，作為最終確認。

測試完成後已把這次啟動的 `npm run dev` 程序關閉（`pkill -f
vite`），沒有留下背景程序。

## 額外副作用：Node 版本警告

跑 `npm run dev` 時看到：

```
You are using Node.js 20.18.0. Vite requires Node.js version 20.19+ or 22.12+.
Please upgrade your Node.js version.
```

跟這次任務無關，沒有動它，但既然診斷過程有看到，一併記錄下來，
供 Lin 之後排時間升級 Node。

## Done criteria 對照

- ✅ 找到 port 漂移的根因，且用原始碼分析＋實際 socket 重現雙重驗證
  （不是只憑猜測）。
- ✅ 明確排除了 WSL2 mirrored/NAT、`.wslconfig`
  `localhostForwarding`、TIME_WAIT/rapid bind-release、孤兒網路
  命名空間、`localhost` DNS 解析順序等假設，並各自寫下排除理由。
- ✅ 應用最小可行修正（`strictPort: true`），驗證 Vite 穩定落在
  5173、三個 health endpoint 透過該 port 都能正常打通（curl 模擬
  瀏覽器 Origin header）。
- ⚠️ `backend/app/main.py` 的 CORS 設定依照最新指示**維持原樣未動**
  （前一版指示要求放寬成 regex，後續指示明確收回，改成純診斷任務）。

## 下一步

- 建議 Lin 實際用瀏覽器打開 `http://127.0.0.1:5173` 做最終肉眼確認
  （這次僅用 curl 模擬）。
- Node.js 版本升級（20.18.0 → 20.19+ 或 22.12+）建議另外排時間處理，
  這次沒有動。
- 是否要把 `vite.config.ts` 這個改動拆到獨立分支、如何跟目前分支上
  混著的 pre-existing WIP 一起處理，留給 Lin 依照當時的 working
  tree 狀態決定（見上方「為什麼沒開新分支」）。
