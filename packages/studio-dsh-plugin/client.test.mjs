import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function loadClientBundle() {
  const source = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
  const effects = []
  const windowListeners = new Map()
  let exported

  const React = {
    useRef(value) {
      return { current: value }
    },
    useCallback(callback) {
      return callback
    },
    useEffect(effect) {
      effects.push(effect)
      effect()
    },
    createElement(type, props = {}, ...children) {
      if (typeof type === 'function') return type({ ...props, children })
      return { type, props, children }
    },
  }

  const window = {
    location: { origin: 'http://127.0.0.1:4173' },
    addEventListener(type, listener) {
      const rows = windowListeners.get(type) ?? []
      rows.push(listener)
      windowListeners.set(type, rows)
    },
    removeEventListener(type, listener) {
      const rows = windowListeners.get(type) ?? []
      windowListeners.set(type, rows.filter(row => row !== listener))
    },
    open() {
      return null
    },
    __ModuleLoader__: {
      load(definition) {
        exported = definition.factory(specifier => {
          if (specifier === 'react') return React
          throw new Error(`unexpected client dependency: ${specifier}`)
        })
      },
    },
  }

  vm.runInNewContext(source, { window, console, encodeURIComponent }, { filename: 'client.js' })
  return { exported, React, window, windowListeners, effects }
}

const plain = value => JSON.parse(JSON.stringify(value))

test('native DSH client registers session-scoped views and sends prompts through the current session', async () => {
  const { exported, window, windowListeners } = await loadClientBundle()
  assert.deepEqual([...exported.inject], ['slots', 'sessions'])

  const promptCalls = []
  const sessions = {
    binding(sessionId) {
      assert.equal(sessionId, 'session-native')
      return {
        session: {
          async prompt(content, mode) {
            promptCalls.push({ content, mode })
            return { ok: true, value: { accepted: true } }
          },
        },
      }
    },
  }

  const registrations = []
  const ctx = {
    get(name) {
      assert.equal(name, 'sessions')
      return sessions
    },
    slots: {
      inject(_name, callback) {
        return callback()
      },
      register(definition, component) {
        registrations.push({ definition, component })
        return () => undefined
      },
    },
  }

  exported.apply(ctx)
  const view = registrations.find(row => row.definition.name === 'conversation.view')
  const header = registrations.find(row => row.definition.name === 'conversation.session.header.actions')
  assert.equal(view?.definition.id, 'report-studio')
  assert.equal(header?.definition.id, 'report-studio')
  assert.equal(typeof view.definition.inject, 'function')
  assert.equal(typeof header.definition.inject, 'function')
  assert.equal(view.definition.inject('session-native').sessions, sessions)
  assert.equal(header.definition.inject('session-native').sessions, sessions)

  const iframe = view.component({
    sessionId: 'session-native',
    ...view.definition.inject('session-native'),
  })
  assert.equal(iframe.type, 'iframe')
  assert.match(iframe.props.src, /^\/report-studio\/\?sessionId=session-native$/)

  const headerButton = header.component({
    sessionId: 'session-native',
    ...header.definition.inject('session-native'),
  })
  assert.equal(headerButton.type, 'button')
  assert.equal(headerButton.children[0], 'Report Studio')

  const promptResults = []
  const frameWindow = {
    postMessage(payload, origin) {
      promptResults.push({ payload, origin })
    },
  }
  iframe.props.ref.current = { contentWindow: frameWindow }

  const event = {
    source: frameWindow,
    origin: window.location.origin,
    data: {
      type: 'report-studio.prompt',
      requestId: 'prompt-1',
      sessionId: 'session-native',
      text: '请读取当前 Report Studio 项目并处理批注。',
    },
  }
  for (const listener of windowListeners.get('message') ?? []) await listener(event)

  assert.deepEqual(plain(promptCalls), [{
    content: [{ type: 'text', text: '请读取当前 Report Studio 项目并处理批注。' }],
    mode: 'queue',
  }])
  assert.deepEqual(plain(promptResults), [{
    payload: {
      type: 'report-studio.prompt-result',
      requestId: 'prompt-1',
      sessionId: 'session-native',
      ok: true,
    },
    origin: window.location.origin,
  }])
})
