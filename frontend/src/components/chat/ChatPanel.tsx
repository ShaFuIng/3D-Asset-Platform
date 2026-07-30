import { useEffect, useRef } from 'react';
import type { ConversationMessage } from '../../types/conversation';
import { ChatComposer } from './ChatComposer';
import { ChatMessage } from './ChatMessage';

type ChatPanelProps = {
  messages: ConversationMessage[];
  prompt: string;
  isGenerating: boolean;
  isUploading: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  activityMessage?: string;
  errorMessage?: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onUpload: (file: File) => void;
};

export function ChatPanel({
  messages,
  prompt,
  isGenerating,
  isUploading,
  isDisabled,
  disabledReason,
  activityMessage,
  errorMessage,
  onPromptChange,
  onSubmit,
  onUpload,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <section className="panel chat-panel">
      <div className="section-header">
        <h2>對話</h2>
        <span>Prompt to image</span>
      </div>

      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-state chat-empty">
            告訴我你想做成什麼 3D 物件；也可以直接上傳一張圖片來建立 3D 模型。
          </div>
        ) : (
          messages.map((message) => <ChatMessage key={message.id} message={message} />)
        )}
        <div ref={bottomRef} />
      </div>

      {(activityMessage || errorMessage) && (
        <div className="chat-status" role="status">
          {activityMessage && <p className="hint success">{activityMessage}</p>}
          {errorMessage && <p className="hint error">{errorMessage}</p>}
        </div>
      )}

      <ChatComposer
        prompt={prompt}
        isGenerating={isGenerating}
        isUploading={isUploading}
        isDisabled={isDisabled}
        disabledReason={disabledReason}
        onPromptChange={onPromptChange}
        onSubmit={onSubmit}
        onUpload={onUpload}
      />
    </section>
  );
}
