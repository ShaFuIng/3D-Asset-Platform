export type ConversationRole = 'user' | 'assistant';

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
  imageId?: string;
};

export function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatMessageTime(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-Hant', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

