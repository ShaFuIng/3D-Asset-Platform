# ComfyUI + Hunyuan3D-2mv 本地部署，打通多視角 mesh pipeline 端到端驗證

- 日期：2026-08-28
- 負責人：kila606
- 分支：`kila606/library-image-picker`
- 相關 Commit：尚未提交（本次改動僅環境安裝 + 一處 working tree 修正，見下）

## 背景

先前 `2026-08-27-frontend-api-base-url-tailnet-fix.md` 記錄「ComfyUI 未安裝，
不在本次範圍」，這次任務要在 Creator M16HX（Windows + WSL2 Ubuntu 24.04，
RTX 4050 6GB VRAM）上把 ComfyUI + Hunyuan3D-2mv 實際部署起來，讓
「OpenAI 產生多視圖 → ComfyUI + Hunyuan3D 生 mesh」這條 pipeline 能在本機
做端到端測試。

## 第一個發現：磁碟上的實際狀態跟最近的 log 記錄不一致

實際檢查這台機器（不是憑印象）後發現：

- `~/comfyui` 其實已經存在，是官方 `comfyanonymous/ComfyUI`
  （`master`，commit `2881e616`），而且 `~/comfyui/comfyui.log` 裡有兩筆
  **成功執行紀錄**（單圖版 `hunyuan3d_api.json`，走的是 ComfyUI 內建原生
  Hunyuan3D 節點，非 custom node），用的是 `gpu` conda env。
- `conda env list` 只有 `base`／`gpu`／`lightsq`，**`3d-asset-platform`
  在這台機器上從未建立過**。追查 kila606 過去的紀錄，`3d-asset-platform`
  這個 env 名稱只出現在 `2026-08-08-blender-usdz-conversion.md`（環境是
  Fedora Sway Atomic + Flatpak sandbox）與
  `2026-08-10-android-ar-tailscale-serve.md`（環境是另一台 Windows 筆電
  的 `.venv`，跟 conda 無關）——**這兩個都不是這台 Creator WSL2**。也就是說
  `2026-08-27` 那筆「ComfyUI 未安裝」的紀錄和這次在磁碟上看到的狀態並不衝突：
  很可能是撰寫該筆記錄的 session 跑在看不到 `~/comfyui` 的 sandbox 環境裡，
  而不是這台機器真的被清空過。這次不假設任何一份舊紀錄是錯的，直接以這次
  現場檢查到的磁碟狀態為準繼續往下做。
- WSL 的 CUDA toolkit（`nvcc` 12.8，`/usr/local/cuda-12.8`）本來就已經是
  系統層級裝好的，跟 conda env 是否存在無關。

## Env 決策

- **Backend**：`3d-asset-platform`（Python 3.10）在這台機器上首次建立，
  `pip install -r backend/requirements.txt` 全部裝成功，`pytest` 基準
  `181 passed`（跟 `2026-08-09-library-usdz-and-ar-visual-verification.md`
  記錄的基準數字一致）。
- **ComfyUI**：沒有繼續沿用 `gpu`（雖然它先前能跑），改成
  `conda create -n comfyui --clone gpu` 另開一個專用 env，理由是
  Hunyuan3DWrapper 的 custom node 需要編譯 `custom_rasterizer`（見下），
  風險隔離在專用 env 裡，不動 `gpu` 本身。ComfyUI 的啟動方式也一併改成
  指向 `comfyui` env。

## Custom node 安裝與一個真正的環境問題

依 workflow JSON（`workflows/多角度3D生成_API.json`）裡 embedded 的
`cnr_id`/`ver` metadata 精確釘住版本安裝：

- kijai `ComfyUI-Hunyuan3DWrapper` @ `2609efa38f6a98292476f714839b7c1e5f9b699a`
- cubiq `ComfyUI_essentials` @ `9d9f4bedfc9f0321c19faf71855e228c93bd0dc9`

兩者的 `requirements.txt` 都順利裝進 `comfyui` env。但編譯
`custom_rasterizer`（Hunyuan3DWrapper 貼圖流程需要的 CUDA extension，官方
只附 Windows wheel，Linux 要自行 build）時，卡在一個真的環境問題：

```
RuntimeError: The detected CUDA version (12.8) mismatches the version that
was used to compile PyTorch (13.0). Please make sure to use the same CUDA versions.
```

`comfyui` env 是從 `gpu` clone 來的，`gpu` 裝的是 torch `2.11.0+cu130`，但
系統 `nvcc` 只有 12.8。三個解法（裝 CUDA 13 toolkit／把 `comfyui` env 的
torch 降版到 cu128／跳過版本檢查）都有取捨，這步驟停下來回報，確認後採用
**只把 `comfyui` env 的 torch 降版到 cu128**（`torch==2.11.0+cu128` /
`torchvision==0.26.0+cu128` / `torchaudio==2.11.0+cu128`，PyTorch 官方剛好
有完全對應的版本，不用降 minor 版本），不動 `gpu`、不裝第二套系統
CUDA toolkit、不繞過檢查。降版後 build 成功（針對 `sm_89` / Ada Lovelace
編譯，跟 RTX 4050 架構相符），並用 `pip install --no-build-isolation .`
正確裝成一個真正的頂層 `custom_rasterizer` package（wrapper 程式碼是
`import custom_rasterizer as cr`，光 `build_ext --inplace` 不夠）。

裝完重啟 ComfyUI，`Import times for custom nodes` 確認兩個 custom node
都正常載入，`/object_info` 也確認所有需要的 node class（`Hy3DModelLoader`、
`Hy3DGenerateMeshMultiView`、`ImageRemoveBackground+`、
`TransparentBGSession+` 等）都有註冊上。

## Checkpoint 放置

沒有直接相信 workflow JSON 裡原本那個字串
（`"hunyun\\tencentHunyuan3D-2mv.safetensors"`，Windows 路徑 + 看起來是
typo），改為直接看 `Hy3DModelLoader` 的原始碼確認：它就是走 ComfyUI 標準的
`folder_paths.get_filename_list("diffusion_models")`，也就是
`models/diffusion_models/` 這個標準資料夾，跟路徑字串裡那個奇怪的
`hunyun\` 前綴無關。

從 kijai wrapper README 指到的 `tencent/Hunyuan3D-2mv`（Hugging Face）下載
`hunyuan3d-dit-v2-mv/model.fp16.safetensors`（約 4.93GB），存成
`models/diffusion_models/hunyuan3d-2mv-fp16.safetensors`。`delight`／
`paint` 兩個 diffusers 模型（`hunyuan3d-delight-v2-0`、
`hunyuan3d-paint-v2-0`）確認是由 `DownloadAndLoadHy3D*Model` 節點在第一次
執行時自動從 Hugging Face 抓，不用手動放。

另外確認 `models/background_removal/`、`models/geometry_estimation/`
維持空資料夾是正常現象：`TransparentBGSession+` 用的是
`transparent_background` 這個 pip package 自帶的 `Remover`，走它自己的
cache 機制，不吃 ComfyUI 這兩個資料夾。

## 修正 workflow JSON 裡的錯誤路徑（working tree only，未 commit）

`workflows/多角度3D生成_API.json` 的 `model` 欄位從壞掉的
`"hunyun\\tencentHunyuan3D-2mv.safetensors"` 改成實際放置的檔名
`"hunyuan3d-2mv-fp16.safetensors"`。只改了 working tree，沒有
`git add`／`commit`，留給 Lin 自行 review 後決定是否 commit。

## VRAM 煙霧測試結果 —— 過了，但餘裕很薄

分兩次測試同一套「shape + texture 全套」的多視角 workflow：

1. **直接打 ComfyUI `/prompt`**（繞過 backend，用暫時 patch 過 model 欄位
   的記憶體內 workflow copy，不動 repo 檔案）：`execution_success`，
   耗時 13 分 50 秒（含 delight/paint 模型第一次下載時間），輸出
   geometry（`Hy3D_00001_.glb`，900KB）與 textured
   （`Hy3D_textured_00001_.glb`，2.8MB）兩個有效 glTF binary。
2. **走 backend 真正的 `create_multiview_model_job` 流程**（見下一節），
   同一套 workflow 再跑一次：一樣成功，耗時 10 分 24 秒（模型已快取，
   比第一次快），輸出結果跟第一次一致。

兩次的 GPU 峰值都落在 **5902～5903 MiB／總量 6141 MiB，只剩不到 240MB
餘裕**。兩次測試當下 GPU 上沒有其他重負載在跑，如果 Windows 桌面端同時有
更多 GPU 佔用（例如瀏覽器影片解碼、桌面合成負載升高），存在 OOM 風險。
**這不算是有寬裕空間的通過**，只能說「這台機器目前空載時剛好放得下」，不是
「有安全邊際」。是否要在正式使用前額外加裝 Hunyuan3D-2GP／MMGP
profile-4 或裁減 workflow，留給 Lin 決定（詳見「下一步」）。

## 發現：`create_multiview_job` 目前唯一支援的是 Qwen（ComfyUI 內生成），不是 OpenAI

原本假設「OpenAI 產生三視圖 → ComfyUI 出 mesh」這條路徑可以完全繞開 Qwen，
但實際看 `backend/app/schemas.py` 與
`backend/app/services/multiview_jobs.py` 才發現：`CreateMultiviewJobRequest.provider`
目前是 `Literal["local"]`，`create_multiview_job` 唯一的初始三視圖生成路徑
是 `run_multiview_image_job`，內部無條件呼叫 `qwen_multiview_workflow`（走
ComfyUI 的 Qwen Image Edit workflow）。`regenerate_multiview_view` 雖然有
OpenAI-edit 策略，但它只能用在**某個 view 已經有 `current_image` 之後**做
局部重新生成，不能從零生成三視圖。也就是說，目前 backend 實際暴露的 API
並不支援「完全用 OpenAI 生成初始三視圖、完全不碰 Qwen/ComfyUI」這條路徑
——這跟這次任務一開始描述的 pipeline 有落差。

這次維持先前決定（Qwen 影像生成 workflow 本身 out of scope，沒有裝
GGUF/Qwen VL 相關 custom node 或模型），改用
`backend/tests/test_multiview.py` 既有的測試手法
（`multiview_job_store.set_images_succeeded()` 直接注入三張測試圖，
跳過 Qwen 這一步）搭建 6c 的測試腳本，其餘步驟——建立 job、
`POST .../views/{view}/accept`、`POST .../model-job`、真正呼叫
`run_multiview_model_job()`——全部走 `create_app()` 建出來的真實
app、真實 `ComfyClient`、真實 `HunyuanMultiviewWorkflow`，打真正在跑的
ComfyUI，不是 mock。三個 view 都用同一張既有測試照片（`~/comfyui/input/test.jpg`）
頂替，純粹驗證管線機制與 VRAM 是否吃得下，不代表輸出的 mesh 有幾何正確性。

## 額外驗證：舊版單圖 workflow 換 env 後仍然正常

env 切換完（ComfyUI 改用 `comfyui` env）之後，先用舊版單圖 workflow
（`hunyuan3d_api.json`）走 backend 自己的 `/api/3d/jobs` 端點（不是直接打
ComfyUI）重新跑一次，成功（約 130 秒，輸出 11.1MB 的有效 GLB），確認
env 搬家沒有弄壞既有的 backend↔ComfyUI 串接。

## 遺留事項

- `~/comfyui/input/` 底下多了三張佔位測試圖
  （`Qwen_24Angles_0000{2,3,4}_.png`，內容是 `test.jpg` 的複製，純粹為了
  跑 6b 的 VRAM 煙霧測試），不是真正的三視角照片，之後要留意別誤用。
- 這次的 6a／6c 測試透過真實 `/api/images/upload`、
  `multiview_job_store` 往 `storage/assets.db`、`storage/images/`、
  `storage/models/` 寫入了幾筆測試資料（reference 圖、front/left/back
  三張、兩個 GLB），沒有清理；比照
  `2026-08-27-reference-stage-library-picker.md` 的先例，若之後要保持
  乾淨可以重建 `storage/assets.db` 並清空 `storage/images/`、
  `storage/models/`（記得先備份），這次沒有主動做這件事。
- Qwen Image Edit workflow（`Qwen_Image_Edit_2511_Front_Left_Back_Q3_K_M_API.json`）
  完全沒有碰，對應的 GGUF unet／Qwen VL clip／VAE／兩個 LoRA 都沒有裝。

## 下一步

- 如果要讓「OpenAI 產生初始三視圖」這條路徑真正在 API 層可用，
  `create_multiview_job`／`CreateMultiviewJobRequest.provider` 需要先擴充，
  這是設計層面的決定，不是單純裝環境能解決的，留給 Lin 評估。
- VRAM 只有不到 240MB 餘裕，正式要用這條 pipeline 生產之前，建議先決定：
  維持現狀（空載才穩）、裁減成 shape-only（拿掉貼圖分支，跟已驗證過的舊版
  單圖流程一樣量級）、或評估 Hunyuan3D-2GP／MMGP profile-4（注意：這是
  跟 ComfyUI 架構完全獨立的 Gradio app，換過去等於放棄現有
  `comfy_client.py` 這條整合方式，是更大的架構決定）。
- 视需要清理「遺留事項」列的測試佔位圖與 storage 測試資料。
