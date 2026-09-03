const clone = value => structuredClone(value)

export function projectAgentContext(state, { pageId = null, stage = null } = {}) {
  const selected = (state.pages ?? []).find(page => page.id === pageId) ?? null
  return {
    project: {
      id: state.project?.id ?? null,
      title: state.project?.title ?? null,
      currentRevision: state.project?.currentRevision ?? null,
    },
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
