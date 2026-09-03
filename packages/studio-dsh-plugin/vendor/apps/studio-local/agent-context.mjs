const clone = value => structuredClone(value)

export function projectAgentContext(state, { pageId = null, stage = null } = {}) {
  const selected = (state.pages ?? []).find(page => page.id === pageId) ?? null
  const project = {
      id: state.project?.id ?? null,
      title: state.project?.title ?? null,
    }
  if (state.project?.currentRevision !== undefined) project.currentRevision = state.project.currentRevision
  return {
    project,
    stage: stage ?? state.ui?.stage ?? null,
    page: selected ? {
      id: selected.id,
      heading: selected.heading ?? '',
      body: selected.body ?? '',
      bullets: clone(selected.bullets ?? []),
      assets: (selected.assets ?? []).map(asset => ({ id: asset.id, name: asset.name ?? null, objectRef: clone(asset.objectRef ?? null), mimeType: asset.mimeType ?? asset.type ?? null })),
    } : null,
  }
}
