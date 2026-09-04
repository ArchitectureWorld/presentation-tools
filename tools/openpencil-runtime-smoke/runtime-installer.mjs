export class RuntimeReleaseError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'RuntimeReleaseError'
    this.code = code
    this.details = details
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(code, message, details = undefined) {
  throw new RuntimeReleaseError(code, message, details)
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(String(value))
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    raw: String(value),
  }
}

function compareStable(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

/** Return the highest stable x.y.z release; prereleases are never promoted. */
export function selectHighestStableVersion(versions, packageName) {
  if (!Array.isArray(versions) || typeof packageName !== 'string' || packageName.trim() === '') {
    fail('runtime_invalid_registry_versions', 'A package name and version list are required')
  }
  const stable = versions
    .map(parseVersion)
    .filter(version => version && version.prerelease === null)
    .sort(compareStable)
  if (stable.length === 0) {
    fail('runtime_no_stable_release', `Registry has no stable release for ${packageName}`, {
      packageName,
      versions,
    })
  }
  return stable.at(-1).raw
}

/** Select a stable pair or fail closed when either side has only prereleases. */
export function selectStableRuntimePair({ dshVersions, openPencilVersions }) {
  return {
    dsh: selectHighestStableVersion(dshVersions, '@deepseek-ai/dsh'),
    openPencil: selectHighestStableVersion(openPencilVersions, '@zseven-w/dsh-openpencil'),
  }
}

/**
 * Build the local OpenPencil compatibility fork manifest. Only DSH peer
 * coordinates change; React and platform package coordinates remain upstream.
 */
export function createOpenPencilCompatibilityManifest(manifest, { targetDshVersion } = {}) {
  if (!object(manifest) || typeof targetDshVersion !== 'string' || targetDshVersion.trim() === '') {
    fail('runtime_invalid_compatibility_manifest', 'A manifest and target DSH version are required')
  }
  const parsedTarget = parseVersion(targetDshVersion)
  if (!parsedTarget || parsedTarget.prerelease === null) {
    fail('runtime_invalid_compatibility_manifest', 'The compatibility target must be an exact prerelease version', {
      targetDshVersion,
    })
  }
  if (!object(manifest.peerDependencies)) {
    fail('runtime_invalid_compatibility_manifest', 'OpenPencil manifest must declare peerDependencies')
  }
  const next = structuredClone(manifest)
  next.version = '0.1.0-compat.1'
  next.description = `${manifest.description ?? 'DSH OpenPencil plugin'} (Report Studio compatibility fork)`
  for (const name of Object.keys(next.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) next.peerDependencies[name] = targetDshVersion
  }
  delete next.peerDependencies['@deepseek-ai/dsh-client-runtime']
  if (Object.hasOwn(next.peerDependencies, '@deepseek-ai/cordis')) {
    next.peerDependencies['@deepseek-ai/cordis'] = '4.0.2'
  }
  if (object(next.dsh) && object(next.dsh.client) && Array.isArray(next.dsh.client.inject)) {
    next.dsh.client.inject = next.dsh.client.inject.filter(name => name !== '@deepseek-ai/dsh-client-runtime')
  }
  return next
}
