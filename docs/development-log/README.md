# 團隊開發紀錄

這個目錄用來補充 Git Commit 無法完整表達的設計原因、驗證結果、已知問題
與交接事項，不取代 Git 歷史。

## 目錄規則

每位組員建立一個自己的資料夾：

```text
development-log/
├─ README.md
├─ TEMPLATE.md
├─ shafuing/
│  ├─ README.md
│  └─ 2026-07-29-initial-scaffold.md
└─ member-name/
   ├─ README.md
   └─ YYYY-MM-DD-topic.md
```

組員資料夾名稱使用固定的 GitHub 帳號或團隊約定英文名稱。紀錄檔名使用：

```text
YYYY-MM-DD-topic.md
```

`topic` 使用簡短的英文 kebab-case，例如：

```text
2026-08-03-model-viewer-loading.md
2026-08-05-comfyui-job-api.md
```

## 什麼情況需要紀錄

- 新增或完成一項功能
- 新增或修改 API
- 改變系統架構或資料格式
- 調整 ComfyUI Workflow
- 解決重要 Bug
- 完成可供其他組員接手的階段

修正錯字、格式或單一 CSS 間距時，不需要建立新紀錄。

## 撰寫方式

1. 複製 [`TEMPLATE.md`](./TEMPLATE.md) 到自己的資料夾。
2. 依 `YYYY-MM-DD-topic.md` 規則命名。
3. 說明目標、完成內容、主要檔案與驗證結果。
4. 明確列出已知問題與下一步，避免接手者重複調查。
5. 若尚未 Commit，可將相關 Commit 保留為「尚未提交」。
