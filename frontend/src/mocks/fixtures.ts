// Fake content used by the mock API client. Add more entries here to widen
// the variety of simulated responses.

export const MOCK_ASSISTANT_REPLIES = [
  '這是根據你的描述產生的圖片，覺得怎麼樣？',
  '我依照你的提示畫了一張圖，需要調整風格嗎？',
  '圖片已經生成，你可以選擇它來建立 3D 模型。',
];

export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
