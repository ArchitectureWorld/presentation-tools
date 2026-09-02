import { describe, expect, it } from 'vitest'
import { DraftPageDocumentSchema, ReviewSubmissionSchema } from './index'

describe('v0.1.0 contracts', () => {
  it('accepts a draft page with stable block ids', () => {
    const parsed = DraftPageDocumentSchema.parse({
      draftDocumentId: 'draft_001', projectId: 'project_001', pageId: 'page_001',
      blocks: [{ contentBlockId: 'block_001', type: 'heading', role: 'page_title', text: '项目目标' }],
      scriptBlocks: [], pageAssets: [],
    })
    expect(parsed.blocks[0].contentBlockId).toBe('block_001')
  })

  it('freezes each submission under the same review round with its own number and base revision', () => {
    const parsed = ReviewSubmissionSchema.parse({
      reviewSubmissionId: 'submission_002', reviewRoundId: 'round_001', submissionNumber: 2,
      baseRevision: 4, requestedExecutionMode: 'review_then_commit', annotationSnapshots: [], createdAt: '2026-09-02T06:30:00Z',
    })
    expect(parsed.reviewRoundId).toBe('round_001')
    expect(parsed.submissionNumber).toBe(2)
  })
})
