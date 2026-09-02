(function universalMockStudioAdapter(root, factory) {
  const core = typeof module === 'object' && module.exports
    ? require('./studio-model.js')
    : root.StudioCore
  const api = factory(core)
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MockStudioAdapter = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAdapterModule(Core) {
  'use strict'

  if (!Core) throw new Error('StudioCore 未加载')

  function createMemoryStorage() {
    const data = new Map()
    return {
      getItem(key) { return data.has(key) ? data.get(key) : null },
      setItem(key, value) { data.set(key, String(value)) },
      removeItem(key) { data.delete(key) },
    }
  }

  function resolveStorage(explicit) {
    if (explicit) return explicit
    try {
      if (typeof localStorage !== 'undefined') return localStorage
    } catch (_) {
      // Browser privacy modes can make localStorage inaccessible.
    }
    return createMemoryStorage()
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function createMockStudioAdapter(options) {
    const opts = options || {}
    const storage = resolveStorage(opts.storage)
    const storageKey = opts.storageKey || 'report-studio.prototype.state'
    const listeners = new Set()

    function loadState() {
      const raw = storage.getItem(storageKey)
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed && parsed.schemaVersion === 'report-studio.state.v2') return parsed
        } catch (_) {
          storage.removeItem(storageKey)
        }
      }
      return Core.createInitialState({ seedComments: opts.seedComments !== false })
    }

    let state = loadState()

    function persist() {
      storage.setItem(storageKey, JSON.stringify(state))
    }

    function notify() {
      const snapshot = clone(state)
      for (const listener of listeners) listener(snapshot)
    }

    function commit(nextState) {
      state = nextState
      persist()
      notify()
      return clone(state)
    }

    persist()

    return {
      getState() {
        return clone(state)
      },

      subscribe(listener) {
        if (typeof listener !== 'function') throw new Error('listener 必须是函数')
        listeners.add(listener)
        return () => listeners.delete(listener)
      },

      setStage(stage) {
        return commit(Core.setStage(state, stage))
      },

      setPage(pageId) {
        return commit(Core.setPage(state, pageId))
      },

      selectTarget(target) {
        return commit(Core.selectTarget(state, target))
      },

      addComment(input) {
        const result = Core.addComment(state, input)
        commit(result.state)
        return result.comment
      },

      updateComment(commentId, input, options) {
        return commit(Core.updateComment(state, commentId, input, options))
      },

      editComment(commentId, input, options) {
        const result = Core.editComment(state, commentId, input, options)
        commit(result.state)
        return result.comment
      },

      setCommentResolved(commentId, resolved, options) {
        return commit(Core.setCommentResolved(state, commentId, resolved, options))
      },

      setCommentCompleted(commentId, completed, options) {
        return commit(Core.setCommentCompleted(state, commentId, completed, options))
      },

      submitRound(roundId, options) {
        const result = Core.submitRound(state, { ...(options || {}), roundId: roundId || undefined })
        commit(result.state)
        return { payload: result.payload, round: result.round, submission: result.submission }
      },

      submitCurrentRound(options) {
        return this.submitRound(null, options)
      },

      completeRound(roundId, result, options) {
        const completed = Core.completeRound(state, roundId, result, options)
        commit(completed.state)
        return { round: completed.round, submission: completed.submission, message: completed.message }
      },

      setRoundExpanded(scopeKey, roundId, expanded) {
        return commit(Core.setRoundExpanded(state, scopeKey, roundId, expanded))
      },

      failRound(roundId, message, options) {
        const failed = Core.failRound(state, roundId, message, options)
        commit(failed.state)
        return { round: failed.round, submission: failed.submission }
      },

      addAsset(pageId, asset) {
        const result = Core.addAsset(state, pageId, asset)
        commit(result.state)
        return result.asset
      },

      removeAsset(pageId, assetId) {
        return commit(Core.removeAsset(state, pageId, assetId))
      },

      updateDraftPage(pageId, patch, options) {
        return commit(Core.updateDraftPage(state, pageId, patch, options))
      },

      updatePageContent(pageId, input, options) {
        return commit(Core.updatePageContent(state, pageId, input, options))
      },

      updateLayoutElement(pageId, elementId, patch) {
        return commit(Core.updateLayoutElement(state, pageId, elementId, patch))
      },

      getCurrentScopeKey() {
        return Core.currentScopeKey(state)
      },

      getCurrentComments() {
        return clone(state.commentsByScope[Core.currentScopeKey(state)] || [])
      },

      getCurrentRounds() {
        return clone(state.roundsByScope[Core.currentScopeKey(state)] || [])
      },

      getCurrentAgentMessages() {
        return clone(state.agentMessagesByScope[Core.currentScopeKey(state)] || [])
      },

      reset(resetOptions) {
        const resetOpts = resetOptions || {}
        state = Core.createInitialState({ seedComments: resetOpts.seedComments !== false })
        persist()
        notify()
        return clone(state)
      },

      exportSnapshot() {
        return JSON.stringify(state, null, 2)
      },
    }
  }

  return { createMockStudioAdapter }
})
