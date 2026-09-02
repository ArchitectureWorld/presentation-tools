import { z } from 'zod'

const stableId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9-]+$`))
export const ProjectIdSchema = stableId('project')
export const PageIdSchema = stableId('page')
export const ContentBlockIdSchema = stableId('block')
export const ReviewRoundIdSchema = stableId('round')
export const ReviewSubmissionIdSchema = stableId('submission')

const HeadingBlockSchema = z.object({ contentBlockId: ContentBlockIdSchema, type: z.literal('heading'), role: z.enum(['page_title','section_heading']), text: z.string() })
const TextBlockSchema = z.object({ contentBlockId: ContentBlockIdSchema, type: z.literal('text'), text: z.string() })
const ListBlockSchema = z.object({ contentBlockId: ContentBlockIdSchema, type: z.literal('list'), items: z.array(z.object({ listItemId: stableId('item'), text: z.string() })) })

export const DraftPageDocumentSchema = z.object({
  draftDocumentId: stableId('draft'), projectId: ProjectIdSchema, pageId: PageIdSchema,
  blocks: z.array(z.discriminatedUnion('type', [HeadingBlockSchema, TextBlockSchema, ListBlockSchema])),
  scriptBlocks: z.array(z.object({ scriptBlockId: stableId('script'), text: z.string() })),
  pageAssets: z.array(z.object({ pageAssetId: stableId('pageasset'), assetId: stableId('asset') })),
})

export const ReviewSubmissionSchema = z.object({
  reviewSubmissionId: ReviewSubmissionIdSchema,
  reviewRoundId: ReviewRoundIdSchema,
  submissionNumber: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  requestedExecutionMode: z.enum(['review_then_commit','direct_commit']),
  annotationSnapshots: z.array(z.object({ annotationId: stableId('annotation'), annotationVersion: z.number().int().positive(), instruction: z.string().min(1) })),
  createdAt: z.string().datetime(),
})

export type DraftPageDocument = z.infer<typeof DraftPageDocumentSchema>
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>
