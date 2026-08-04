import type { FormEvent, KeyboardEvent } from 'react';

type ChatComposerProps = {
  prompt: string;
  isGenerating: boolean;
  isUploading: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onUpload: (file: File) => void;
};

export function ChatComposer({
  prompt,
  isGenerating,
  isUploading,
  isDisabled,
  disabledReason,
  onPromptChange,
  onSubmit,
  onUpload,
}: ChatComposerProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      {isDisabled && disabledReason && <p className="hint warning">{disabledReason}</p>}
      <label className="sr-only" htmlFor="prompt-input">
        圖片生成提示詞
      </label>
      <textarea
        id="prompt-input"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你想產生的角色、物件或風格..."
        disabled={isGenerating}
      />
      <div className="chat-actions">
        <label className="upload-control">
          <span>{isUploading ? 'Uploading...' : '上傳圖片'}</span>
          <input
            type="file"
            accept="image/*"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUpload(file);
                event.currentTarget.value = '';
              }
            }}
          />
        </label>
        <button type="submit" disabled={isDisabled || isGenerating || !prompt.trim()}>
          {isGenerating ? 'Generating...' : '送出'}
        </button>
      </div>
    </form>
  );
}
