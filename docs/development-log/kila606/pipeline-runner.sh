#!/usr/bin/env bash
#
# Pipeline Runner — 圖片轉 3D 模型完整流程執行工具
#
# 定位：遠端開發常用工具，非一次性測試腳本。
# 目的：把「上傳圖片 → 建立 3D Job → 輪詢狀態 → 下載模型」這套固定順序封裝成
#       單一可呼叫指令，讓 agent 或開發者不需要每次重新查閱 API 規格、
#       重新推導執行順序，直接呼叫即可取得結果。
#
# 個人開發工具（kila606），非團隊正式架構的一部分。
#
# 前提：
#   1. Creator 上的 ComfyUI 須已啟動並監聽對外介面（見
#      docs/development-log/kila606/2026-08-02-elitebook-remote-comfyui-setup.md）
#   2. EliteBook 上的 FastAPI 後端須已啟動：
#      conda activate 3d-asset-platform
#      cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000
#   3. .env 中 COMFYUI_BASE_URL 須指向 Creator 的 Tailscale IP
#
# 用法：
#   ./pipeline-runner.sh [圖片路徑]
#   未指定圖片路徑時，自動生成一張測試用圖片。
#
# 輸出：
#   成功時印出下載到的 GLB 檔案路徑，供後續流程（例如載入 Viewer）直接使用。

set -euo pipefail

API_BASE="http://127.0.0.1:8000"
IMAGE_PATH="${1:-}"
MAX_POLL=30
POLL_INTERVAL=5

if [ -z "$IMAGE_PATH" ]; then
  IMAGE_PATH="/tmp/pipeline-runner-image.png"
  echo "未指定圖片，生成預設測試圖片：$IMAGE_PATH" >&2
  python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (512, 512), color=(70, 130, 180))
draw = ImageDraw.Draw(img)
draw.ellipse([156, 156, 356, 356], fill=(255, 200, 0))
img.save('$IMAGE_PATH')
"
fi

echo "=== 1. 上傳圖片 ===" >&2
UPLOAD_RESULT=$(curl -sS -X POST "$API_BASE/api/images/upload" \
  -F "image=@${IMAGE_PATH}")
echo "$UPLOAD_RESULT" | python3 -m json.tool >&2
IMAGE_ID=$(echo "$UPLOAD_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['image_id'])")
echo "取得 image_id: $IMAGE_ID" >&2

echo "=== 2. 建立 3D Job ===" >&2
JOB_RESULT=$(curl -sS -X POST "$API_BASE/api/3d/jobs" \
  -H "Content-Type: application/json" \
  -d "{\"image_id\": \"${IMAGE_ID}\"}")
echo "$JOB_RESULT" | python3 -m json.tool >&2
JOB_ID=$(echo "$JOB_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['job_id'])")
echo "取得 job_id: $JOB_ID" >&2

echo "=== 3. 輪詢 Job 狀態 ===" >&2
STATUS=""
for i in $(seq 1 "$MAX_POLL"); do
  RESULT=$(curl -sS "$API_BASE/api/3d/jobs/$JOB_ID")
  STATUS=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")
  echo "[$i] 狀態: $STATUS" >&2
  if [ "$STATUS" != "queued" ] && [ "$STATUS" != "processing" ]; then
    echo "$RESULT" | python3 -m json.tool >&2
    break
  fi
  sleep "$POLL_INTERVAL"
done

if [ "$STATUS" != "succeeded" ]; then
  echo "Job 未成功完成，狀態為: $STATUS" >&2
  exit 1
fi

echo "=== 4. 下載並驗證模型 ===" >&2
OUTPUT_PATH="/tmp/pipeline-model-${JOB_ID}.glb"
curl -sS "$API_BASE/api/3d/jobs/$JOB_ID/model" -o "$OUTPUT_PATH"
ls -la "$OUTPUT_PATH" >&2
file "$OUTPUT_PATH" >&2

# 只有最終的檔案路徑印到 stdout，方便被其他指令或 agent 直接擷取使用
echo "$OUTPUT_PATH"
