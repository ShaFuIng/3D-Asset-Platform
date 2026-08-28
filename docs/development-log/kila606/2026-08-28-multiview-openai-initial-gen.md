# 多視角 pipeline 加入 OpenAI 平行路徑：不裝 Qwen/ComfyUI 也能跑完整流程

- 日期：2026-08-28
- 負責人：kila606
- 分支：`kila606/multiview-openai-initial-gen`（從 `main` 開出）
- 相關 Commit：尚未提交（本次改動留在 working tree，未 `git add`／`commit`，交給 Lin review）

## 背景

延續 `2026-08-28-comfyui-hunyuan3d-2mv-deployment.md` 最後一節的發現：
`create_multiview_job` 目前唯一支援的初始三視圖生成路徑是 Qwen
（走 ComfyUI），`CreateMultiviewJobRequest.provider` 也只接受
`"local"`，導致「完全用 OpenAI、完全不碰 Qwen/ComfyUI」這條路徑在
API 層根本不存在。這次任務就是把這條路徑補上——**新增一條平行路徑，
Qwen 那條路徑完全不動**，讓使用者自己選要用哪一個，在一台沒裝
ComfyUI/Qwen 的乾淨機器上也能跑完整的多視角流程。

## 做了什麼（Backend）

- `schemas.py`：`CreateMultiviewJobRequest.provider` 與三個回應 model
  的 `provider` 欄位從 `Literal["local"]` 擴成
  `Literal["local", "openai"]`；`RegenerateStrategy` 新增
  `openai_reroll`（盲重抽，不帶 instruction，驗證規則比照
  `local_reroll` 一起擋掉非 null 的 instruction）。
- 新檔 `services/multiview_openai_prompts.py`：`OPENAI_VIEW_PROMPTS`
  （front/left/back 三個固定 prompt），對應 `multiview_workflows.py`
  裡 Qwen 的 `QWEN_PROMPTS`，但只寫視角本身的指示——通用的置中/乾淨背景
  /保留身分等規則已經在 `openai_client.py` 的
  `IMAGE_GENERATION_INSTRUCTIONS`（system 層級）涵蓋過了，不重複寫。
- `openai_client.py`：新增 `generate_multiview_view()`，包一層
  `edit_image(..., OPENAI_VIEW_PROMPTS[view])`，跟既有的
  `edit_multiview_image()`（openai_edit 用）平行。
- `services/multiview_jobs.py`：新增兩個 job function，
  `run_multiview_image_job_openai`（初始三視圖，迴圈
  `VIEW_ORDER` 呼叫 `generate_multiview_view`）與
  `run_multiview_view_regeneration_job_openai`（單一視角的
  openai_reroll）。存檔用 `openai-{view}` 前綴（見下方「跟計畫不同的
  地方」）。
- `routers/multiview.py`：
  - `create_multiview_job` 的 ComfyUI preflight
    （`comfy_client.ensure_available()` +
    `qwen_multiview_workflow.prepare_three_view_workflow(...)`）改成只在
    `provider == "local"` 才執行；`provider == "openai"` 走全新的
    `run_multiview_image_job_openai`，不碰 Comfy/Qwen 任何一行。
  - `regenerate_multiview_view` 新增 `openai_reroll` 分支，來源圖片選
    reference image（跟 `local_reroll` 一樣，不是 `openai_edit` 用的
    current image——理由見下方設計決策）。

## 做了什麼（Frontend）

- `types/api.ts`：`MultiviewProvider` 加 `'openai'`；
  `RegenerateStrategy`／判別聯集／`MultiviewVersionStrategy` 都加
  `'openai_reroll'`。
- `api/client.ts`：`createMultiviewJob` 的 `provider` 從寫死 `'local'`
  改成參數（預設 `'local'`，不破壞既有呼叫端）；body type 裡三個
  `provider: 'local'` 跟 `strategy` 聯集都放寬。
- `WorkspaceContext.tsx`：`startMultiview` 多一個 `provider` 參數；
  `regenerateView` 組 payload 的邏輯簡化成「`openai_edit` 才帶
  instruction，其餘（`local_reroll`／`openai_reroll`）都是純
  `{ strategy }」。
- `MultiviewStagePage.tsx`：「生成 Front / Left / Back」按鈕前面加一組
  Qwen／OpenAI radio 選擇（純 UI state，不影響既有 job），按對應
  provider 的可用狀態禁用按鈕並顯示原因。
- `ViewCard.tsx`：在「重新抽選（本機）」與「使用 GPT 調整」中間插入
  「重新抽選（OpenAI）」按鈕，不需要文字輸入。
- `ImageLightbox.tsx`：`getStrategyLabel` 原本是
  `initial / local_reroll / (其餘一律 GPT Edit)` 的三段式判斷，新增
  `openai_reroll` 分支避免它被誤標成「GPT Edit」（見下方「跟計畫不同
  的地方」）。

## 設計決策：`openai_reroll` 的來源圖片是 reference image，不是 current image

任務說明只寫「mirrors local_reroll (blind regenerate, no
instruction)」，但沒有明講來源圖片要用哪一張。看了
`local_reroll`（用 reference image + Qwen 重新生成）跟
`openai_edit`（用 current image + 使用者 instruction 微調）兩種既有
語意後，判斷「mirrors local_reroll」指的不只是「不需要
instruction」，也包含「從 reference 重新生成」這個來源選擇——這樣
`openai_reroll` 才真的是 openai_edit 之外、跟 local_reroll 對等的
另一種「重新抽一次」，而不是 openai_edit 拿掉 instruction 檢查的
變體。`run_multiview_view_regeneration_job_openai` 因此直接複製
`run_multiview_view_regeneration_job`（Qwen 版）的參數形狀，吃
`reference: ImageRecord`。

## 跟計畫不同／額外補上的地方

1. **檔名前綴改用 `openai-{view}`，且同步擴充
   `KNOWN_IMAGE_PREFIXES`**：任務要求「先確認沒有其他程式碼依賴
   `qwen-` 檔名前綴，才能換成別的前綴」。查證結果：`save_image_bytes`
   本身用 UUID 當 `image_id`、直接 upsert 進 SQLite，正常運作路徑完全
   不看檔名前綴；唯一的依賴點是 `asset_catalog.py` 的
   `KNOWN_IMAGE_PREFIXES`（`qwen-front/left/back`），只在
   `AssetCatalog.reconcile()`——也就是**資料庫遺失後、純掃磁碟重建
   asset id** 這條回復路徑——用檔名前綴反推回原本的 UUID。這條路徑不
   影響一般功能，但為了讓 openai 產生的圖片將來也享有同樣的災難復原
   能力，同步把 `openai-front/left/back` 加進
   `KNOWN_IMAGE_PREFIXES`，並在 `test_asset_catalog.py` 補了三個對應
   的 parametrize case。
2. **`MultiviewViewVersionResponse.strategy`（backend）與
   `MultiviewVersionStrategy`（frontend）也加了 `openai_reroll`**：
   任務清單沒有明列這兩個型別，但 version history 本來就會記錄
   `regeneration_strategy`，不加的話 openai_reroll 產生的版本在
   response model／前端型別上會對不上，schema 驗證會直接炸掉，判斷是
   任務描述的遺漏，一併補上。
3. **修正 `ImageLightbox.tsx` 裡一個會被新策略值放大的既有 bug**：
   `getStrategyLabel` 是 `initial → local_reroll → 其餘一律 GPT
   Edit` 的三段式判斷，加了 `openai_reroll` 這個新策略值之後，如果不
   額外處理，它會落到「其餘」分支被誤標成「GPT Edit」（使用者會誤以為
   花了 OpenAI edit 額度、還被要求填過 instruction）。這不是這次新增
   的 bug，是既有程式碼在型別擴充後才會暴露的問題，一併修掉。
4. **補了 5 個新測試 + 3 個 parametrize case**（任務完成標準沒有明講
   要不要寫測試，但既有的 `test_multiview.py` 覆蓋率很完整，判斷補齊
   比較保險）：
   - `test_create_multiview_job_openai_provider_skips_comfy_preflight`
     ／`test_regenerate_openai_reroll_endpoint_queues_one_view_without_comfy`：
     刻意不呼叫 `prepare_multiview_app()`、把 `FakeComfyClient` 設成
     `available=False`，驗證 `provider="openai"` 與
     `strategy="openai_reroll"` 兩條路徑完全不會摸到 Comfy/Qwen。
   - `test_run_multiview_image_job_openai_saves_distinct_assets_without_comfy`
     ／`test_run_view_regeneration_openai_uses_reference_and_sets_candidate`：
     對應 Qwen 版兩個既有的 job-level 單元測試。
   - `test_regenerate_openai_reroll_rejects_instruction`：對應
     `local_reroll` 的既有測試。
   - `conftest.py` 的 `FakeOpenAIClient` 補了
     `generate_multiview_view()`。
   全部測試（189 個，含新增的 8 個）與 `tsc -b` 都在這個分支上跑過，
   全過。

## 分支建立過程的一個插曲：pre-existing WIP 跟這次改動混在同一份 working tree

開始改動時，working tree 已經有跟這次任務無關的舊 session 遺留內容
（`.env.example`、`README.md`、`docs/development-log/kila606/README.md`
的索引更新、`workflows/多角度3D生成_API.json` 的路徑修正,還有兩篇
未加入 git 的 dev log 草稿），而且分支是 `kila606/library-image-picker`
（比 `main` 多一個 commit）。照任務指示要從 `main` 開新分支，但這樣
會把上述舊內容一起帶進來，混進這次的 diff 裡。

原計畫用 `git stash push` 把舊內容單獨隔開，但這個指令被權限設定擋下
（`git stash push` 本身被拒絕，不是操作失敗）。改用不需要 `git
stash` 的做法：先把舊內容的 diff 存成 patch
（`git diff -- <舊檔案們> > pre-existing-wip.patch`），兩篇未加入
git 的草稿也複製一份出去，逐一 diff 比對備份檔跟原檔內容一致後，才用
`git checkout -- <舊檔案們>` 還原 tracked 檔案、`rm` 掉未加入 git 的
草稿副本，讓 working tree 只剩這次任務改動的檔案，再
`git checkout -b kila606/multiview-openai-initial-gen main`。

**這個備份目前只放在這次 session 的 scratchpad 暫存目錄**
（`/tmp/claude-1000/.../scratchpad/pre-existing-wip.patch` 與兩篇
`.md` 草稿），**不在 repo 裡，session 結束後可能會被清掉**。Lin 需要
自行決定要不要在 `kila606/library-image-picker` 分支上用這份 patch
復原那些內容（`git apply pre-existing-wip.patch` + 手動放回兩篇
`.md`），這次沒有主動幫忙復原，怕誤觸原分支的其他改動。

## Done criteria 對照

- ✅ `provider: "openai"` 生成三視圖全程不摸 ComfyUI/Qwen（見上面第 4
  點新測試，刻意在 ComfyUI 回報不可用時測試）。
- ✅ 單一視角 `openai_reroll` 不需要 instruction 文字也能跑。
- ✅ 既有 Qwen 路徑（`local` provider、`local_reroll`、`openai_edit`）
  未變更任何行為，189 個測試（含原本 181 個）全過。

## 下一步

- 這次沒有實機打 OpenAI API 驗證 `generate_multiview_view` 產生的圖片
  品質（`OPENAI_VIEW_PROMPTS` 的用字是否真的讓三個視角有足夠區隔度），
  只驗證了程式邏輯層面（用 `FakeOpenAIClient`）。正式使用前建議實際跑
  一次，確認 front/left/back 三張圖確實有可辨識的視角差異。
- 上述 pre-existing WIP 的 patch 備份需要 Lin 決定去留。
