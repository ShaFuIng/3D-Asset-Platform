# 端到端圖片轉 3D 模型 Pipeline 測試（個人測試設定）

- 日期：2026-08-03
- 負責人：kila606
- 分支：`main`
- 相關 Commit：尚未提交

## 本次目標
在前一篇紀錄（2026-08-02）完成 EliteBook 環境與跨機器 ComfyUI 連線設定的基礎上，
實際跑一次完整的圖片上傳 → 3D 模型生成 pipeline，驗證的不只是網路層連線，
而是應用層真正能產出可用的模型檔案。

## 完成內容
- 確認 SSH 斷線後，Creator 上以 `nohup`／`disown` 啟動的 ComfyUI 仍持續運作，
  未受影響。
- 確認 EliteBook 上以前景方式啟動的 FastAPI 後端，會隨終端機視窗關閉而終止，
  已重新啟動。
- 透過 `/openapi.json` 查詢實際的 API 欄位規格，避免用猜的方式測試導致
  422 驗證錯誤。
- 完整跑過一次 pipeline：上傳測試圖片 → 建立 3D Job → 輪詢狀態 → 下載並驗證
  產出的 GLB 檔案。
- 將整套流程封裝為可重複呼叫的開發工具 `pipeline-runner.sh`，供日後開發與
  agent 直接呼叫，不需重新推導執行順序。

## 主要修改檔案
- `docs/development-log/kila606/pipeline-runner.sh`（新增）

## 設計與實作說明
測試圖片以 Pillow 在本機直接生成（512x512 純色圖形），非真實停車場照片，
僅用於驗證 pipeline 是否能跑通，不代表實際生成品質。Job 狀態在第一次輪詢
（間隔 5 秒）就已回傳 `succeeded`，推測是對話過程中的間隔時間已足夠讓
Creator 端的 GPU 完成運算，而非真實生成耗時僅 5 秒。

`pipeline-runner.sh` 的輸出設計為過程訊息導向 stderr、僅最終 GLB 路徑導向
stdout，方便被其他指令或 agent 直接擷取結果，不需自行解析過程 log。

## 驗證方式與結果
執行：
```text
POST /api/images/upload  （multipart，欄位 image）
POST /api/3d/jobs        （JSON，欄位 image_id）
GET  /api/3d/jobs/{job_id}   （輪詢至 status 非 queued/processing）
GET  /api/3d/jobs/{job_id}/model  （下載 GLB）
```
結果：通過。
- `image_id`: 上傳成功，取得 UUID
- `job_id`: 建立成功，初始狀態 `queued`
- 最終狀態：`succeeded`
- 下載檔案：`2,382,248 bytes`，經 `file` 指令確認為
  `glTF binary model, version 2`，非空檔案或錯誤訊息偽裝。

完整流程已封裝為可重複呼叫的開發工具，見
[`pipeline-runner.sh`](./pipeline-runner.sh)，供後續開發與 agent 直接呼叫，
不需重新推導執行順序。

## 已知問題
- 測試圖片為程式生成的簡單圖形，尚未用真實停車場／車輛照片驗證生成品質。
- 尚未在 Three.js Viewer 中實際載入並檢視產出的 GLB 模型。
- 沿用 2026-08-02 紀錄中列出的已知問題（`--listen` 裸用、Tailscale 容器需
  手動啟動、ComfyUI 未整合服務管理等），本次測試未變更這些狀態。

## 下一步
- 用真實圖片測試，評估實際生成品質是否符合需求。
- 在前端 Three.js Viewer 中載入本次產出的 GLB，確認前端載入流程也一併可用。
