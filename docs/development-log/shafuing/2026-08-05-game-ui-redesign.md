# 2026-08-05：Game UI Redesign 與階段導覽整理

- 日期：2026-08-05
- 負責人：shafuing
- 分支：`feat/game-ui-redesign`
- 相關 Commit：本文件所在提交

## 本次目標

將既有功能型 MVP 介面整理為更一致的遊戲／終端風格 UI，並統一首頁與各
Stage 頁面的五階段導覽規則。同時修正 Reference Gallery、首頁動畫與
Multiview Version Lightbox 在 Round 2／Round 3 檢查中發現的操作與同步問題。

## 完成內容

### 首頁與整體視覺

- 首頁改為左／中／右三區：
  - 左側顯示 Asset Library 計數與 Backend／OpenAI／ComfyUI 服務狀態。
  - 中央為可點擊的 orbital 裝置入口，進入 Reference 階段但保留目前工作階段。
  - 右側為五階段 Session Navigation。
- 新增 `OrbitalDevice` 與 `useCursorParallax`，提供 CSS-driven 視覺裝置與游標視差。
- `useCursorParallax` 改為 settled 後停止 `requestAnimationFrame`，下一次 pointer move 再重啟。
- 導入暗色終端風格 token、panel、button、badge、card、scrollbar 與 stage shell 樣式。
- 修正首頁掃描線造成的 ghost scrollbar：Home 裝飾層改由容器裁切，動畫改用 transform。

### 五階段導覽

- 新增 `frontend/src/navigation/stageNav.ts` 作為首頁與 `StageShell` 共用的五階段導覽純函式。
- 固定階段為 Reference、Mode、Views、Generate、Inspect。
- 導覽只根據現有 workspace state 產生目的 route，不觸發 API。
- Single pipeline 中 Views 顯示不適用；Multiview 在三視圖接受前鎖定 Generate。
- Missing Job／Missing Model recovery 畫面可透過 `showSessionStepper={false}` 隱藏 session stepper，不再 fallback 到目前 selected image。
- Recovery 畫面同時隱藏大型 stage index，避免出現無 session 狀態的 `00` 裝飾數字。

### Reference、Mode 與 View Cards

- Reference Gallery 改為 responsive grid，避免 hover 位移與長文字造成水平溢出。
- Sticky action bar 保留，但 Stage body 加入底部 padding，降低遮住最後列的機率。
- Mode Card 改為暗色卡片、左側狀態 marker 與更明確的 selected／hover／focus 對比。
- Multiview View Card 改為暗色狀態框，版本數、Accept、Local Reroll 與 GPT Edit 控制保留原流程。
- ChatPanel 的新對話按鈕改為專用樣式與更清楚文案，但原確認流程與 reset scope 不變。

### Multiview Version Lightbox

- Version thumbnail strip 從水平滾動改為換行排列，避免幽靈水平捲軸。
- Set Candidate 錯誤改為 Lightbox 專屬 local error，不再直接顯示共用 `workspace.error`。
- `setViewCandidate` 回傳 `{ ok, error }`，讓頁面層直接使用本次 action 的錯誤訊息。
- 共用 `workspace.error` 仍保留，Reference panel 仍可顯示後端錯誤。
- 關閉或重新開啟 Lightbox 會清除本地 candidate error。

## 主要修改檔案

- `frontend/src/components/StageShell.tsx`
- `frontend/src/components/OrbitalDevice.tsx`
- `frontend/src/components/chat/ChatPanel.tsx`
- `frontend/src/context/WorkspaceContext.tsx`
- `frontend/src/hooks/useCursorParallax.ts`
- `frontend/src/navigation/stageNav.ts`
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/JobProgressPage.tsx`
- `frontend/src/pages/ModeSelectPage.tsx`
- `frontend/src/pages/MultiviewStagePage.tsx`
- `frontend/src/pages/ReferenceStagePage.tsx`
- `frontend/src/pages/ViewerStagePage.tsx`
- `frontend/src/styles.css`

## 設計與實作說明

`stageNav.ts` 是這次導覽整理的單一規則來源。首頁右側 Session Navigation
與各 Stage 頁上方 Stepper 都使用相同 helper，因此 Reference、Mode、Views、
Generate、Inspect 的 available／locked／done／na 狀態不會各自分岔。

首頁中央 CTA 的文字改為「進入資產工作區」，避免「開始新資產」被理解為會清空
目前 workspace。實際行為仍只是進入 `/reference`，不清除 conversation、
reference images、Single job、Multiview job 或 model job。

Multiview Set Candidate 的錯誤處理由頁面層直接讀取 action result，避免用
effect 監聽共用 `workspace.error` 時，因相同錯誤訊息或 React batching 造成
Lightbox 無法正確顯示本次錯誤。

## 驗證方式與結果

執行：

```text
cd frontend
npm run typecheck
npm run build
```

結果：

- `npm run typecheck` 通過。
- `npm run build` 通過。
- Vite 仍提示既有 chunk size warning，主要來自 Three.js bundle，未阻止建置完成。

## 已知問題

- Game UI 仍是第一版整體風格，尚未做完整逐頁視覺 QA。
- 首頁 CTA 使用百分比定位，不同高度螢幕下仍需實機目視確認。
- Job、Multiview workspace 與 version history 仍保存在記憶體，重新整理或後端重啟後不恢復。
- package.json 沒有 test script，本輪只執行 typecheck 與 build。
- Vite production build 仍有 chunk size warning，尚未切分 Three.js viewer chunk。

## 下一步

- 進行桌機與手機寬度的完整人工回歸測試。
- 補足 Game UI 細節 QA：focus、hover、scroll、modal、long filename 與低高度 viewport。
- 評估 Viewer 與 Three.js bundle code splitting。
- 規劃 Job／Multiview Version History 的持久化資料模型。
