import type { ConversationMessage as ConversationMessageType } from '../../types/conversation';

type ChatMessageProps = {
  message: ConversationMessageType;
};

export function ChatMessage({ message }: ChatMessageProps) {
  return (
    <article className={`chat-message ${message.role}`}>
      <div className="chat-message-meta">
        <span>{message.role === 'user' ? '你' : 'Assistant'}</span>
        <time>{message.createdAt}</time>
      </div>
      <p>{message.content}</p>
    </article>
  );
}
