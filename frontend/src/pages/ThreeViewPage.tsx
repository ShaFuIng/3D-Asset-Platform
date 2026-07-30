const viewSlots = [
  {
    id: 'front',
    title: 'Front',
    description: '正面視圖',
  },
  {
    id: 'side',
    title: 'Side',
    description: '側面視圖',
  },
  {
    id: 'back',
    title: 'Back',
    description: '背面視圖',
  },
];

export function ThreeViewPage() {
  return (
    <section className="three-view-page" aria-labelledby="three-view-title">
      <div className="page-intro">
        <p className="eyebrow">Three-view workspace</p>
        <h2 id="three-view-title">三視圖生成工作區</h2>
        <p>
          此頁面保留未來 front、side、back 三視圖生成流程的介面位置，目前尚未接入生成流程。
        </p>
      </div>

      <div className="three-view-layout">
        <section className="panel three-view-chat">
          <div className="section-header">
            <h2>對話</h2>
            <span>尚未接入生成流程</span>
          </div>
          <div className="empty-state chat-empty">
            未來會在這裡輸入三視圖生成需求。目前此頁不呼叫 OpenAI、ComfyUI 或三視圖 API。
          </div>
          <form className="chat-composer">
            <label className="sr-only" htmlFor="three-view-prompt">
              三視圖生成需求
            </label>
            <textarea
              id="three-view-prompt"
              placeholder="三視圖生成流程尚未接入。"
              disabled
            />
            <button type="button" disabled>
              尚未接入生成流程
            </button>
          </form>
        </section>

        <section className="panel three-view-preview-panel">
          <div className="section-header">
            <h2>三視圖預覽</h2>
            <span>Front / Side / Back</span>
          </div>
          <div className="three-view-grid">
            {viewSlots.map((slot) => (
              <article className="view-slot" key={slot.id}>
                <div className="view-slot-header">
                  <strong>{slot.title}</strong>
                  <span>{slot.description}</span>
                </div>
                <div className="view-placeholder">尚未接入生成流程</div>
              </article>
            ))}
          </div>
          <button type="button" disabled>
            尚未接入生成流程
          </button>
        </section>
      </div>
    </section>
  );
}
