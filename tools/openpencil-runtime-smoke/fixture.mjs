import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415408d763f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082',
  'hex',
)

export async function createRuntimeFixture(documentsDir) {
  await mkdir(documentsDir, { recursive: true })
  const assetPath = join(documentsDir, 'fixture.png')
  await writeFile(assetPath, PNG_1X1)

  return {
    assetPath,
    documentPath: join(documentsDir, 'report-studio-runtime-smoke.op'),
    renderPlan: {
      layoutPageId: 'layout_page_runtime_smoke',
      projectId: 'project_runtime_smoke',
      pageId: 'page_runtime_smoke',
      canvas: { width: 1200, height: 675, unit: 'studio_unit' },
      elements: [
        {
          layoutElementId: 'layout_element_runtime_title',
          type: 'text',
          frame: { x: 72, y: 56, width: 720, height: 72, rotation: 0 },
          style: { fontSize: 42, fontWeight: 700, textColor: '#111827', textAlign: 'left' },
          zIndex: 10,
          syncPolicy: 'live',
          elementState: 'normal',
          sourceKey: 'fixture:title',
          payload: { kind: 'text', sourceType: 'heading', role: 'page_title', content: 'Report Studio Runtime Smoke' },
        },
        {
          layoutElementId: 'layout_element_runtime_body',
          type: 'text',
          frame: { x: 72, y: 156, width: 640, height: 120, rotation: 0 },
          style: { fontSize: 24, fontWeight: 400, textColor: '#374151', textAlign: 'left' },
          zIndex: 9,
          syncPolicy: 'live',
          elementState: 'normal',
          sourceKey: 'fixture:body',
          payload: { kind: 'text', sourceType: 'paragraph', role: 'body', content: 'Real OpenPencil document lifecycle verification.' },
        },
        {
          layoutElementId: 'layout_element_runtime_image',
          type: 'image',
          frame: { x: 780, y: 120, width: 320, height: 240, rotation: 0 },
          style: { fit: 'cover', cornerRadius: 8, opacity: 1 },
          zIndex: 8,
          syncPolicy: 'live',
          elementState: 'normal',
          sourceKey: 'fixture:image',
          payload: {
            kind: 'asset',
            pageAssetId: 'page_asset_runtime_smoke',
            assetId: 'asset_runtime_smoke',
            caption: 'Controlled test image',
            objectRef: { sha256: 'a'.repeat(64), sizeBytes: PNG_1X1.length, mimeType: 'image/png' },
            metadata: { widthPx: 1, heightPx: 1 },
          },
        },
        {
          layoutElementId: 'layout_element_runtime_shape',
          type: 'shape',
          frame: { x: 72, y: 560, width: 520, height: 8, rotation: 0 },
          style: { fill: '#2563EB', opacity: 1 },
          zIndex: 2,
          syncPolicy: 'detached',
          elementState: 'normal',
          sourceKey: null,
          payload: { shapeKind: 'rectangle' },
        },
        {
          layoutElementId: 'layout_element_runtime_group',
          type: 'group',
          frame: { x: 48, y: 32, width: 1104, height: 592, rotation: 0 },
          style: { opacity: 1 },
          zIndex: 0,
          syncPolicy: 'detached',
          elementState: 'normal',
          sourceKey: null,
          payload: { label: 'Runtime Smoke Group' },
        },
      ],
    },
  }
}
