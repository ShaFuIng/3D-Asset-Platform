# EliteBook 環境設定與遠端 ComfyUI 連線（個人測試設定）

- 日期：2026-08-02
- 負責人：kila606
- 分支：`main`
- 相關 Commit：尚未提交

## 本次目標
在 EliteBook（Fedora Sway Atomic）上建立可運作的本機開發環境，並讓後端能透過既有的
Tailscale 網路連線到 Creator 上執行的 ComfyUI，取代原先設想的 SSH tunnel 方式。

## 完成內容
- 在 EliteBook 上安裝 Miniconda，建立 `3d-asset-platform` conda 環境（Python 3.10.11，
  走 conda-forge 頻道，避開 Anaconda defaults 頻道的 Terms of Service 限制）。
- 安裝後端依賴（`backend/requirements.txt`），版本與 `docs/README.md` 記錄一致。
- 安裝 Node.js 22（透過 nvm）與前端依賴（`npm ci`）。
- 將 Creator 上原本只監聽 `127.0.0.1` 的 ComfyUI，改為加上 `--listen` 參數重新啟動
  （`nohup` 背景執行，使用 `gpu` conda 環境），使其可透過 Tailscale 網路對外連線。
- 修改 EliteBook 上的 `.env`，將 `COMFYUI_BASE_URL` 由 `http://127.0.0.1:8188`
  改為 Creator 的 Tailscale 位址 `http://100.122.205.65:8188`。

## 主要修改檔案
- `.env`（本機檔案，未提交版本控制）

## 設計與實作說明
原始構想是透過 SSH 連線測試後端與 ComfyUI 的連通性，但實際測試後發現不需要額外疊加
SSH tunnel：Tailscale 本身即為加密的私有網路，只要讓 ComfyUI 監聽對外介面，後端即可
直接透過 Tailscale 位址連線。這個做法比 SSH port-forward 少一層需要維護的中介，但目前
的 `--listen`（未指定 IP，預設監聽所有介面 `0.0.0.0`／`::`）僅適用於 Creator 目前所處
的網路環境（WSL2 內部 + 家用路由器 NAT 隔離，僅 Tailscale 路徑可實際連入）。若未來套用
到校園網路等更公開的環境（例如學校的 Blackwell server），應改為
`--listen <該機器的 Tailscale IP>`，明確只綁定 Tailscale 介面，避免服務對整個校園網路
開放。

## 驗證方式與結果
執行：
```text
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 5 http://100.122.205.65:8188
curl -s http://127.0.0.1:8000/api/comfy/health
```
結果：通過。前者回傳 `200`，後者回傳
`{"status":"connected","service":"comfyui","base_url":"http://100.122.205.65:8188",...}`，
確認網路層與應用層皆已打通。後端測試同時以 `pytest` 驗證，結果為 `39 passed`，與
`docs/README.md` 記錄一致。

## 已知問題
- Creator 端 ComfyUI 目前以裸 `--listen`（監聽所有介面）啟動，屬於個人測試環境下的暫時
  設定，**非團隊正式架構決策**。若他人或正式環境的伺服器（例如學校 GPU 伺服器）需要類似
  連線方式，請勿直接沿用此設定，應改為綁定明確的 Tailscale IP。
- EliteBook 的 Tailscale 是跑在 podman 容器內（非系統常駐服務），每次使用前需手動
  `sudo podman start tailscale`。
- 目前 Tailscale 連線走 DERP relay（非直連），延遲約 120ms，大檔案傳輸會較慢，尚未排查
  直連失敗原因。
- ComfyUI 目前是手動於 Creator 上以 `nohup` 啟動，未整合進正式的服務管理（例如
  systemd），重開機後需手動重新啟動。

## 下一步
- 評估是否需要將 ComfyUI 啟動流程整合進 systemd 或其他服務管理機制，避免每次重開機都
  要手動啟動。
- 排查 Tailscale DERP relay 而非直連的原因，改善大檔案傳輸速度。
- 若確定要沿用此連線模式到校園 GPU 伺服器，需先確認該伺服器的網路曝露範圍，並改用綁定
  明確 IP 的 `--listen` 設定。
