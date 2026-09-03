export const REQUIRED_LAYOUT_ADAPTER_METHODS = Object.freeze([
  'mount',
  'render',
  'readViewportState',
  'destroy',
])

export class LayoutAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'LayoutAdapterError'
    this.code = code
    this.details = details
  }
}

function valueType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function assertLayoutAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw new LayoutAdapterError(
      'layout_adapter_invalid',
      'Layout adapter must be a plain object implementing the adapter lifecycle.',
      { adapterType: valueType(adapter) },
    )
  }

  for (const method of REQUIRED_LAYOUT_ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new LayoutAdapterError(
        'layout_adapter_missing_method',
        `Layout adapter must implement ${method}().`,
        { method },
      )
    }
  }

  return adapter
}
