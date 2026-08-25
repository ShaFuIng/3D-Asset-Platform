# 模型校正 Phase 0：assets.db migration 機制 + parent_asset_id 欄位

- 日期：2026-08-26
- 負責人：kila606
- 分支：`kila606/model-calibration-phase0`
- 相關 Commit：尚未提交

## 本次目標

這是「GLB 真實尺度校正 + STL 列印匯出」計畫的 Phase 0，先不碰校正邏輯本身，
只鋪地基：`backend/app/asset_catalog.py` 原本用 `CREATE TABLE IF NOT EXISTS`
建表，對已經存在的 `assets.db` 是 no-op，新增欄位不會生效；`PRAGMA
user_version` 雖然有讀寫，但沒有任何依版本號執行 `ALTER TABLE` 的邏輯，形同
虛設。這次要把這個 migration 機制真正補上，並用它加一個 `parent_asset_id`
欄位（nullable、不用 FK constraint），讓 Phase 1 以後的校正功能可以把
「校正後的 GLB」跟「來源 raw GLB」的關係記錄下來。這次**沒有**動
`parent_asset_id` 以外的任何欄位或邏輯，也沒有動 `reconcile()` /
`_ensure_no_dependencies()`，這些留給後續 Phase。

## 上一輪測試抓到的問題：SCHEMA_VERSION 撞號

第一版實作把 `SCHEMA_VERSION` 直接設成 `1`，判斷式是：

```python
while version < SCHEMA_VERSION:  # SCHEMA_VERSION = 1
    ...
```

測試情境二（模擬已存在的舊 DB）沒過。原因：**改動前的舊程式碼**本來就會在
第一次跑 `initialize()` 時把 `user_version` 設成 `1`：

```python
if version < 1:
    connection.execute("PRAGMA user_version = 1")
```

也就是說，任何真的在開發環境跑過一次後端的 `storage/assets.db`，
`user_version` 早就已經是 `1` 了。新程式碼的 `SCHEMA_VERSION` 也設成
`1`，兩個值撞在一起，`1 < 1` 為 False，migration 直接被跳過——新程式碼會
誤判「這個 DB 已經是最新版本」，`parent_asset_id` 永遠加不進去。這個問題只
有在**模擬已存在的舊 DB**這個情境才測得出來，全新環境測不出來（全新 DB
的 `user_version` 預設是 `0`，不會撞號）。

## 這次怎麼修：重新定義版本號的意義（方案一）

不改動判斷邏輯本身，改成重新定義 0/1/2 三個版本號各自代表什麼，讓 `1` 這個
已經被舊程式碼用掉的值維持原本的意義，新的欄位改配到 `2`：

- **0**：全新、從沒跑過 `initialize()` 的 DB（`PRAGMA user_version` 的
  SQLite 預設值，沒人動過它）。
- **1**：舊程式碼留下的既有基準——所有已經存在的 `assets.db` 實際所在
  的版本，沒有 `parent_asset_id` 欄位。這個值是歷史既定事實，不是這次
  migration 機制可以重新分配的「第一步」。
- **2**：加了 `parent_asset_id` 之後的版本，也是這個 migration 機制第一次
  真正需要負責跑到的目標版本。

```python
SCHEMA_VERSION = 2

_MIGRATIONS: dict[int, tuple[str, ...]] = {
    2: ("ALTER TABLE assets ADD COLUMN parent_asset_id TEXT",),
}
```

這樣不管 DB 現在的 `user_version` 是 `0`（全新）還是 `1`（舊程式碼留下的
既有基準），都會落在 `while version < 2` 這個條件裡，實際跑到
`ALTER TABLE`。

另外把 `CREATE TABLE IF NOT EXISTS` 那段 SQL 文字也加上了
`parent_asset_id TEXT`，讓全新安裝一眼就能看出目前完整 schema 長怎樣。
這麼做不會跟 migration 衝突：全新 DB 建表時欄位已經存在，之後
migration 迴圈跑到 `ALTER TABLE ADD COLUMN parent_asset_id` 這步會撞到
`duplicate column name`，但 `_apply_migration_statement()` 本來就會接住
這個特定錯誤訊息、安全跳過，不會噴錯。

`upsert_asset()` 的 `ON CONFLICT` 也維持上一輪的作法：`parent_asset_id`
用 `COALESCE(excluded.parent_asset_id, assets.parent_asset_id)`，不是跟
其他欄位一樣直接 `= excluded.xxx`——一般 upsert 呼叫沒帶這個值的話會保留
既有值，不會被意外清成 NULL。

## 驗證方式與結果

三個測試情境（沿用上一輪的腳本，只把預期版本號從 1 改成 2）：

**情境一：全新環境**

```text
has parent_asset_id: True
user_version: 2
```
PASS。

**情境二：模擬已存在的舊 DB**——先用改動前的 schema（不含
`parent_asset_id`）建表、`user_version` 設成 `1`（對應舊程式碼真實會留下
的狀態），塞兩筆假資料（一筆 image、一筆已 trash 的 model），再跑改動後的
`AssetCatalog`：

```text
has parent_asset_id: True
user_version: 2
asset count: 2
 - asset-2 model legacy.glb parent_asset_id=None status=missing deleted_at=2026-01-03T00:00:00+00:00 size_bytes=456
 - asset-1 image legacy.png parent_asset_id=None status=available deleted_at=None size_bytes=123
```

兩筆假資料的 `filename`／`status`／`deleted_at`／`size_bytes` 都完整保留，
沒有遺失或損壞。PASS。

**情境三：對已經 migrate 到 2 的 DB 再跑一次 `initialize()`**（模擬後端
重啟，建第二個 `AssetCatalog` instance 指向同一個 db 檔）：

```text
user_version stays at: 2
parent_asset_id column count: 1
no exception raised
```

沒有重複執行 migration、沒有噴錯、欄位沒有重複出現。PASS。

**現有 pytest**：

```text
181 passed, 1 warning in 4.95s
```

全部通過，沒有既有測試因為這次改動壞掉。

（環境備註：這次跑測試前另外手動建了 `backend/.venv`，用系統內建的
Python 3.12——這台機器的 system `python3` 是 3.14，`imghdr` 這個 stdlib
模組在 3.13 就被移除了，直接裝會 import 失敗；`.venv/` 已在
`.gitignore`，不影響 git 狀態，跟這次程式改動本身無關，純粹記錄一下。）

## 已知問題

- `parent_asset_id` 目前只是一個空欄位，還沒有任何程式碼會寫入或讀取
  它——這次 Phase 0 的範圍就只到「欄位存在、migration 機制可靠」為止，
  怎麼在校正流程裡使用這個欄位（例如校正後 GLB 要不要另開一筆
  asset、`reconcile()` 掃到 `models_dir` 裡的校正後檔案會不會被誤判成
  幽靈 asset）留給 Phase 1 以後處理。
- 這次沒有替 `SCHEMA_VERSION` / `_MIGRATIONS` 這個機制本身寫獨立的
  pytest（只用手動腳本驗證三個情境），之後如果要加第二個 migration
  （schema version 3），建議把這幾個手動腳本情境轉成
  `tests/test_asset_catalog.py` 裡的正式測試案例，避免以後改動時要重新
  手動驗證一次。

## 下一步

- 決定 Phase 1（baking 服務、新 API endpoint）要怎麼使用
  `parent_asset_id`：校正後的 GLB 是否要開一筆新 asset、用
  `parent_asset_id` 指回 raw GLB 的 asset_id。
- 補上前面調查報告點出的缺口：single-view／multiview 的 Inspect 頁面
  目前前端根本拿不到 asset_id（`Create3DJobResponse`／`JobResponse`／
  `MultiviewModelJobResponse` 都沒有這個欄位），這會擋住這三個進入點
  之中兩個進入點的校正功能。
