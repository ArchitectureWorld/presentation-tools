import { isAbsolute, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'
import { readStandardProject, writeStandardProject } from '../../packages/studio-standard-adapter/index.mjs'

export function createStandardProjectService(repository) {
  return Object.freeze({
    status() {
      const state = repository.getState()
      return {
        standardVersion: '0.1.0',
        projectId: state.project.id,
        currentRevision: state.project.currentRevision,
        compatible: repository.migrationStatus().status === 'ready',
      }
    },
    async importProject(projectRoot) {
      if (!isAbsolute(String(projectRoot ?? ''))) {
        throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '导入路径必须是本机绝对路径。', { projectRoot }, 400)
      }
      const imported = await readStandardProject(projectRoot, { putBlob: repository.putBlob })
      const state = await repository.initializeFromStandardProject({
        snapshot: imported.snapshot,
        detail: { actionType: 'standard.import', sourceProjectRoot: resolve(projectRoot) },
        ui: { stage: imported.snapshot.pages.length ? 'draft' : 'outline', activePageId: imported.snapshot.pages[0]?.id ?? null },
      })
      return { state, validation: imported.validation }
    },
    async exportProject() {
      const state = repository.getState()
      const snapshot = await repository.getSnapshotAt(state.project.currentRevision)
      const batch = new Date().toISOString().replaceAll(':', '-')
      const exportRoot = join(repository.root, 'exports', batch)
      await mkdir(exportRoot, { recursive: true })
      const exported = await writeStandardProject({ snapshot, exportRoot, openBlob: repository.openBlob })
      return { ...exported, revision: state.project.currentRevision }
    },
  })
}
