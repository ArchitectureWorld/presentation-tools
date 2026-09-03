import test from 'node:test'
import assert from 'node:assert/strict'
import { LayoutAdapterError, assertLayoutAdapter } from './index.mjs'

const REQUIRED_METHODS = ['mount', 'render', 'readViewportState', 'destroy']

function completeAdapter() {
  return Object.fromEntries(REQUIRED_METHODS.map(name => [name, () => undefined]))
}

test('assertLayoutAdapter accepts and returns a complete replaceable adapter', () => {
  const adapter = completeAdapter()
  assert.equal(assertLayoutAdapter(adapter), adapter)
})

test('assertLayoutAdapter rejects non-object values', () => {
  assert.throws(
    () => assertLayoutAdapter(null),
    error => error instanceof LayoutAdapterError
      && error.code === 'layout_adapter_invalid'
      && error.details?.adapterType === 'null',
  )
})

for (const method of REQUIRED_METHODS) {
  test(`assertLayoutAdapter rejects an adapter missing ${method}()`, () => {
    const adapter = completeAdapter()
    delete adapter[method]
    assert.throws(
      () => assertLayoutAdapter(adapter),
      error => error instanceof LayoutAdapterError
        && error.code === 'layout_adapter_missing_method'
        && error.details?.method === method,
    )
  })
}
