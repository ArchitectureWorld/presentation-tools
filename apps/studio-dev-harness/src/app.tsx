import { useState } from 'react'

type Stage = 'outline' | 'draft'

export function StudioApp() {
  const [stage, setStage] = useState<Stage>('outline')
  return (
    <main>
      <header>
        <strong>Report Studio v0.1.0</strong>
        <nav aria-label="工作阶段">
          <button type="button" aria-pressed={stage === 'outline'} onClick={() => setStage('outline')}>大纲</button>
          <button type="button" aria-pressed={stage === 'draft'} onClick={() => setStage('draft')}>草案</button>
          <button type="button" disabled>排版</button>
        </nav>
      </header>
      <section aria-live="polite">
        {stage === 'outline' ? <h1>大纲工作区</h1> : <h1>草案工作区</h1>}
        <p>排版功能将在 v0.2.0 开放</p>
      </section>
    </main>
  )
}
