#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function verifyReleaseMetadata(rootDir = path.resolve(__dirname, '..')) {
  const version = readText(path.join(rootDir, 'VERSION')).trim()
  const packageJson = JSON.parse(readText(path.join(rootDir, 'package.json')))
  const manifest = JSON.parse(readText(path.join(rootDir, 'release-manifest.json')))
  const buildScript = readText(path.join(rootDir, 'scripts/build-single-file.js'))

  const errors = []

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push(`VERSION 不是有效的语义化版本号：${version}`)
  }
  if (packageJson.version !== version) {
    errors.push(`package.json 版本 ${packageJson.version} 与 VERSION ${version} 不一致`)
  }
  if (manifest.version !== version) {
    errors.push(`release-manifest.json 版本 ${manifest.version} 与 VERSION ${version} 不一致`)
  }
  if (!buildScript.includes(`single-file-v${version}`)) {
    errors.push(`构建脚本未写入 single-file-v${version}`)
  }

  const manifestArtifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : []
  if (manifestArtifacts.length === 0) errors.push('release-manifest.json 未声明发布文件')

  const checksumFilePath = path.join(rootDir, 'dist/SHA256SUMS')
  const checksumEntries = fs.existsSync(checksumFilePath)
    ? readText(checksumFilePath).trim().split(/\r?\n/).filter(Boolean).map(line => {
        const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/)
        if (!match) {
          errors.push(`SHA256SUMS 格式无效：${line}`)
          return null
        }
        return { sha256: match[1], path: match[2] }
      }).filter(Boolean)
    : []
  if (checksumEntries.length === 0) errors.push('dist/SHA256SUMS 不存在或为空')

  const manifestByPath = new Map(manifestArtifacts.map(artifact => [artifact.path, artifact]))
  const artifacts = checksumEntries.map(entry => ({
    ...(manifestByPath.get(entry.path) || {
      path: entry.path,
      mediaType: entry.path.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
      purpose: 'Release artifact',
    }),
    sha256: entry.sha256,
  }))

  for (const artifact of manifestArtifacts) {
    const checksumEntry = checksumEntries.find(entry => entry.path === artifact.path)
    if (!checksumEntry) errors.push(`SHA256SUMS 未包含 manifest 发布文件：${artifact.path}`)
    else if (checksumEntry.sha256 !== artifact.sha256) errors.push(`manifest 与 SHA256SUMS 的哈希不一致：${artifact.path}`)
  }


  const verifiedArtifacts = artifacts.map(artifact => {
    const absolutePath = path.join(rootDir, artifact.path)
    if (!fs.existsSync(absolutePath)) {
      errors.push(`发布文件不存在：${artifact.path}`)
      return { ...artifact, exists: false }
    }

    const actualSize = fs.statSync(absolutePath).size
    const actualSha256 = sha256(absolutePath)
    if (typeof artifact.sizeBytes === 'number' && actualSize !== artifact.sizeBytes) {
      errors.push(`文件大小不一致：${artifact.path}，manifest=${artifact.sizeBytes}，actual=${actualSize}`)
    }
    if (actualSha256 !== artifact.sha256) {
      errors.push(`SHA-256 不一致：${artifact.path}，manifest=${artifact.sha256}，actual=${actualSha256}`)
    }

    if (artifact.path.endsWith('.html')) {
      const html = readText(absolutePath)
      if (!html.includes(`content="single-file-v${version}"`)) {
        errors.push(`HTML 构建元数据不是 single-file-v${version}：${artifact.path}`)
      }
    }

    return {
      ...artifact,
      exists: true,
      actualSize,
      actualSha256,
    }
  })

  if (errors.length > 0) {
    const error = new Error(`发布校验失败：\n- ${errors.join('\n- ')}`)
    error.details = errors
    throw error
  }

  return {
    ok: true,
    version,
    artifacts: verifiedArtifacts,
  }
}

if (require.main === module) {
  try {
    const result = verifyReleaseMetadata()
    console.log(`Release metadata verified: v${result.version}`)
    for (const artifact of result.artifacts) {
      console.log(`- ${artifact.path}: ${artifact.actualSize} bytes, sha256=${artifact.actualSha256}`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { verifyReleaseMetadata }
