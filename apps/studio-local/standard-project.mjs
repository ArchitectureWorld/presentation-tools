import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'
import { readStandardProject, writeStandardProject } from '../../packages/studio-standard-adapter/index.mjs'

function exportError(error, details) {
  if (error instanceof StudioError) return error
  return new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '标准项目导出失败。', {
    ...details,
    cause: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
  }, 500)
}

export function createStandardProjectService(repository, {
  exportDirectoryName = () => `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
  fileSystem = { mkdir, lstat, rename, rm },
} = {}) {
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
      const exportsRoot = join(repository.root, 'exports')
      const stagingRoot = join(exportsRoot, '.staging')
      const directoryName = exportDirectoryName()
      const stage = join(stagingRoot, directoryName)
      const finalRoot = join(exportsRoot, directoryName)
      let staged = false
      try {
        await fileSystem.mkdir(stagingRoot, { recursive: true })
        await fileSystem.mkdir(stage)
        staged = true
        const exported = await writeStandardProject({ snapshot, exportRoot: stage, openBlob: repository.openBlob })
        try {
          await fileSystem.lstat(finalRoot)
          throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '标准项目导出目标已存在，未覆盖既有导出。', { finalRoot }, 409)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
        await fileSystem.rename(stage, finalRoot)
        staged = false
        const projectRoot = join(finalRoot, relative(stage, exported.projectRoot))
        return { ...exported, projectRoot, revision: state.project.currentRevision }
      } catch (error) {
        if (staged) {
          try {
            await fileSystem.rm(stage, { recursive: true, force: true })
          } catch (cleanupError) {
            throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '标准项目导出失败，且 staging 目录清理失败。', {
              stage,
              finalRoot,
              cause: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
              cleanupCause: { name: cleanupError?.name ?? 'Error', message: cleanupError?.message ?? String(cleanupError) },
            }, 500)
          }
        }
        throw exportError(error, { stage, finalRoot })
      }
    },
  })
}
