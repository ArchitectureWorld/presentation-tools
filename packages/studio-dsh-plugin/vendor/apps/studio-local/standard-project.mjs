import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { lstat, mkdir, rename, rm, rmdir } from 'node:fs/promises'
import { ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'
import { readStandardProject, writeStandardProject } from '../../packages/studio-standard-adapter/index.mjs'

function exportError(error, details) {
  if (error instanceof StudioError) return error
  return new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '标准项目导出失败。', {
    ...details,
    cause: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
  }, 500)
}

async function command(commandName, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(commandName, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', rejectCommand)
    child.once('close', code => resolveCommand({ code, stderr }))
  })
}

async function assertPublishedDirectory(source, destination, sourceInfo, verifyIdentity) {
  try {
    await lstat(source)
    throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '无覆盖发布后 staging 项目目录仍存在。', { source, destination }, 500)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const destinationInfo = await lstat(destination)
  if (!destinationInfo.isDirectory()) throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '无覆盖发布目标不是目录。', { source, destination }, 500)
  if (verifyIdentity && (sourceInfo.dev !== destinationInfo.dev || sourceInfo.ino !== destinationInfo.ino)) {
    throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '无覆盖发布目标不是本次 staging 项目目录。', { source, destination }, 500)
  }
}

export async function publishDirectoryNoReplace(source, destination) {
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory()) throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '待发布对象不是目录。', { source, destination }, 500)
  if (process.platform === 'win32') {
    try {
      await rename(source, destination)
    } catch (error) {
      throw exportError(error, { source, destination, operation: 'rename_no_replace_windows' })
    }
    await assertPublishedDirectory(source, destination, sourceInfo, false)
    return
  }
  if (process.platform === 'linux') {
    let result
    try {
      result = await command('mv', ['--no-clobber', '--no-target-directory', '--', source, destination])
    } catch (error) {
      throw exportError(error, { source, destination, operation: 'mv_no_clobber_linux' })
    }
    if (result.code !== 0) throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, 'Linux 无覆盖目录发布失败。', { source, destination, exitCode: result.code, stderr: result.stderr }, 500)
    await assertPublishedDirectory(source, destination, sourceInfo, true)
    return
  }
  throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '当前平台不支持无覆盖目录发布。', { platform: process.platform, source, destination }, 501)
}

export function createStandardProjectService(repository, options = {}) {
  const clock = options.clock ?? (() => new Date())
  const uuid = options.randomUUID ?? randomUUID
  const exportDirectoryName = options.exportDirectoryName ?? (() => `${clock().toISOString().replaceAll(':', '-')}-${uuid()}`)
  const fileSystem = { mkdir, rename, rm, rmdir, ...(options.fileSystem ?? {}) }
  const publish = options.publishDirectoryNoReplace ?? publishDirectoryNoReplace
  const retryDelayMs = options.cleanupRetryDelayMs ?? 1000
  const scheduleRetry = options.scheduleRetry ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay)
    timer.unref?.()
    return timer
  })
  const pendingStagingCleanup = new Set()
  let retryScheduled = false

  async function retryPendingStagingCleanup() {
    for (const stage of [...pendingStagingCleanup]) {
      try {
        await fileSystem.rm(stage, { recursive: true, force: true })
        pendingStagingCleanup.delete(stage)
      } catch {
        // Keep the stage in the retry queue; its next retry is scheduled below.
      }
    }
    if (pendingStagingCleanup.size) schedulePendingStagingCleanup()
    return [...pendingStagingCleanup]
  }

  function schedulePendingStagingCleanup() {
    if (retryScheduled) return
    retryScheduled = true
    scheduleRetry(async () => {
      retryScheduled = false
      await retryPendingStagingCleanup()
    }, retryDelayMs)
  }

  async function cleanupPublishedStage(stage) {
    try {
      await fileSystem.rm(stage, { recursive: true, force: true })
      return null
    } catch (error) {
      pendingStagingCleanup.add(stage)
      schedulePendingStagingCleanup()
      return Object.freeze({
        status: 'pending',
        code: 'staging_cleanup_pending',
        stage,
        message: error?.message ?? String(error),
        retryScheduled: true,
      })
    }
  }

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
      if (basename(directoryName) !== directoryName) {
        throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '标准项目导出目录名无效。', { directoryName }, 400)
      }
      const stage = join(stagingRoot, directoryName)
      const finalRoot = join(exportsRoot, directoryName)
      let staged = false
      let finalBatchClaimed = false
      try {
        await fileSystem.mkdir(stagingRoot, { recursive: true })
        await fileSystem.mkdir(stage)
        staged = true
        const exported = await writeStandardProject({ snapshot, exportRoot: stage, openBlob: repository.openBlob })
        await fileSystem.mkdir(finalRoot)
        finalBatchClaimed = true
        const projectDirectoryName = relative(stage, exported.projectRoot)
        if (basename(projectDirectoryName) !== projectDirectoryName) {
          throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, 'staging 项目目录无效。', { stage, projectRoot: exported.projectRoot }, 500)
        }
        const projectRoot = join(finalRoot, projectDirectoryName)
        await publish(exported.projectRoot, projectRoot)
        const cleanup = await cleanupPublishedStage(stage)
        return { ...exported, projectRoot, revision: state.project.currentRevision, ...(cleanup ? { cleanup } : {}) }
      } catch (error) {
        const cleanupFailures = []
        if (staged) {
          try { await fileSystem.rm(stage, { recursive: true, force: true }) } catch (cleanupError) { cleanupFailures.push(cleanupError) }
        }
        if (finalBatchClaimed) {
          try { await fileSystem.rmdir(finalRoot) } catch (cleanupError) { cleanupFailures.push(cleanupError) }
        }
        if (cleanupFailures.length) {
          throw new StudioError(ERROR_CODES.STANDARD_EXPORT_FAILED, '标准项目导出失败，且候选目录清理失败。', {
            stage,
            finalRoot,
            cause: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
            cleanupCauses: cleanupFailures.map(cleanupError => ({ name: cleanupError?.name ?? 'Error', message: cleanupError?.message ?? String(cleanupError) })),
          }, 500)
        }
        throw exportError(error, { stage, finalRoot })
      }
    },
    retryPendingStagingCleanup,
  })
}
