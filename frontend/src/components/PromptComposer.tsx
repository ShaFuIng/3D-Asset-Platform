import type { FormEvent } from 'react';

type PromptComposerProps = {
  prompt: string;
  isGenerating: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onUpload: (file: File) => void;
};

export function PromptComposer({
  prompt,
  isGenerating,
  isDisabled,
  disabledReason,
  onPromptChange,
  onSubmit,
  onUpload,
}: PromptComposerProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <section className="panel workspace-panel">
      <div className="section-header">
        <h2>Prompt</h2>
        <span>Generate or upload a source image</span>
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="描述你想生成的角色、道具或物件..."
          disabled={isGenerating}
        />
        <button type="submit" disabled={isDisabled || isGenerating || !prompt.trim()}>
          {isGenerating ? 'Generating...' : 'Generate Image'}
        </button>
      </form>

      {isDisabled && disabledReason && <p className="hint warning">{disabledReason}</p>}

      <label className="upload-control">
        <span>Upload Image</span>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onUpload(file);
              event.currentTarget.value = '';
            }
          }}
        />
      </label>
    </section>
  );
}

