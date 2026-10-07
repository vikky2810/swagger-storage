'use strict'

/**
 * Runs in the browser, injected into the Swagger UI page via
 * swagger-ui-express's `customJs` option. It captures whatever a user types
 * into an operation's OAS3 request body editor into localStorage, and
 * re-seeds those values back in on the next page load.
 *
 * IMPORTANT: this script executes at parse time, well before swagger-ui's
 * own `swagger-ui-init.js` fires (that file assigns `window.onload = ...`
 * directly rather than using addEventListener, and only runs on the `load`
 * event). So `window.ui` does not exist yet when this file's top level runs
 * — everything here must be deferred to a `load` listener, and it must use
 * addEventListener rather than reassigning `window.onload`, or it would
 * clobber swagger-ui-init.js's handler and Swagger UI would never
 * initialize. Verified live against swagger-ui-express@5 / swagger-ui-dist.
 */
;(function () {
  var TOKEN = null
  var DEBUG = false

  function log() {
    if (!DEBUG) return
    var args = ['[swagger-storage]'].concat(Array.prototype.slice.call(arguments))
    console.log.apply(console, args)
  }

  function storageKey(method, path) {
    return 'swagger-storage:' + TOKEN + ':' + method.toLowerCase() + ':' + path
  }

  function readStored(method, path) {
    try {
      return window.localStorage.getItem(storageKey(method, path))
    } catch (e) {
      return null
    }
  }

  function writeStored(method, path, value) {
    try {
      if (value === undefined || value === null || value === '') {
        window.localStorage.removeItem(storageKey(method, path))
      } else {
        window.localStorage.setItem(storageKey(method, path), value)
      }
    } catch (e) {
      // localStorage full/unavailable (private browsing, quota, etc.) — degrade silently
    }
  }

  // Form bodies (x-www-form-urlencoded / multipart) are stored as JSON behind
  // this prefix; JSON and plain text bodies are stored as the raw string.
  var FORM_PREFIX = 'swagger-storage-form:'

  // What 0.1.1 wrote for form bodies: an Immutable Map's toString(), which
  // can't be parsed back.
  var LEGACY_FORM_VALUE = /^(Ordered)?Map \{/

  function isPlainValue(v) {
    if (v === null) return true
    var type = typeof v
    if (type === 'string' || type === 'number' || type === 'boolean') return true
    if (Array.isArray(v)) return v.every(isPlainValue)
    return false
  }

  /**
   * Turns a request body value into the string to store. Returns '' when
   * there is nothing worth storing, or undefined when the value can't be
   * stored at all and the existing entry should be left alone.
   */
  function serializeBodyValue(value) {
    if (value === undefined || value === null || typeof value === 'string') return value
    if (typeof value.toJS !== 'function') return undefined

    // Form bodies look like { field: { value, errors } }. Only `value` is
    // kept, flattened to { field: value } because that's the shape
    // setRequestBodyValue takes. File uploads (File/Blob) can't go into
    // localStorage and are dropped.
    var fields = value.toJS()
    var out = {}
    var count = 0
    Object.keys(fields).forEach(function (name) {
      var field = fields[name]
      if (!field || typeof field !== 'object' || !isPlainValue(field.value)) return
      out[name] = field.value
      count++
    })
    return count > 0 ? FORM_PREFIX + JSON.stringify(out) : ''
  }

  /**
   * Builds Immutable values without Immutable itself, which Swagger UI
   * doesn't expose: empty Map/List instances are taken from the store state
   * (an Immutable Map) and filled in.
   */
  function toImmutable(ui, js) {
    var state = ui.getState()
    var emptyMap = state.clear()
    var emptyList = state.toList().clear()

    function convert(v) {
      if (Array.isArray(v)) return emptyList.concat(v.map(convert))
      if (v && typeof v === 'object') {
        return emptyMap.withMutations(function (m) {
          Object.keys(v).forEach(function (k) {
            m.set(k, convert(v[k]))
          })
        })
      }
      return v
    }
    return convert(js)
  }

  /** Turns a stored string back into a request body value, or undefined if unusable. */
  function deserializeBodyValue(ui, stored) {
    if (stored.indexOf(FORM_PREFIX) === 0) {
      return toImmutable(ui, JSON.parse(stored.slice(FORM_PREFIX.length)))
    }
    if (LEGACY_FORM_VALUE.test(stored)) return undefined
    return stored
  }

  /** Returns [{ path, method }] for every operation in the loaded spec. */
  function listOperations(ui) {
    var ops = []
    try {
      var paths = ui.specSelectors.paths()
      if (!paths || typeof paths.forEach !== 'function') return ops
      paths.forEach(function (methodsMap, path) {
        methodsMap.forEach(function (_operation, method) {
          ops.push({ path: path, method: method })
        })
      })
    } catch (e) {
      log('failed to enumerate operations', e)
    }
    return ops
  }

  function requestBodyValue(ui, op) {
    try {
      return ui.oas3Selectors.requestBodyValue(op.path, op.method)
    } catch (e) {
      return undefined
    }
  }

  function restoreSavedValues(ui, ops) {
    ops.forEach(function (op) {
      var saved = readStored(op.method, op.path)
      if (saved == null) return
      var pathMethod = [op.path, op.method]
      try {
        var value = deserializeBodyValue(ui, saved)
        if (value === undefined) {
          writeStored(op.method, op.path, null)
          log('dropped unreadable saved value for', op.method, op.path)
          return
        }
        ui.oas3Actions.setRequestBodyValue({ value: value, pathMethod: pathMethod })
        // Without this, Swagger UI's RequestBody component resets the field
        // back to the spec's default example value the first time it mounts
        // (e.g. when the user clicks "Try it out"), clobbering the restore.
        if (typeof ui.oas3Actions.setRetainRequestBodyValueFlag === 'function') {
          ui.oas3Actions.setRetainRequestBodyValueFlag({ value: true, pathMethod: pathMethod })
        }
        log('restored', op.method, op.path)
      } catch (e) {
        log('failed to restore', op.method, op.path, e)
      }
    })
  }

  /** The spec loads asynchronously; poll briefly until operations appear. */
  function waitForSpec(ui, cb) {
    var attempts = 0
    var maxAttempts = 100 // ~10s at 100ms
    var timer = setInterval(function () {
      attempts++
      var ops = listOperations(ui)
      if (ops.length > 0 || attempts >= maxAttempts) {
        clearInterval(timer)
        cb(ops)
      }
    }, 100)
  }

  function attach(ui) {
    if (!TOKEN) {
      console.warn('[swagger-storage] no project token found on window.__SWAGGER_STORAGE_TOKEN__ — persistence disabled. Run `npm install` in your project so the postinstall script can generate one.')
      return
    }
    if (!ui || typeof ui.getStore !== 'function' || !ui.oas3Actions || !ui.oas3Selectors) {
      console.warn('[swagger-storage] this swagger-ui version does not expose the expected oas3Actions/oas3Selectors API — persistence disabled.')
      return
    }

    waitForSpec(ui, function (initialOps) {
      restoreSavedValues(ui, initialOps)

      var lastSeen = {}
      initialOps.forEach(function (op) {
        lastSeen[op.method + ' ' + op.path] = requestBodyValue(ui, op)
      })

      ui.getStore().subscribe(function () {
        var ops = listOperations(ui)
        ops.forEach(function (op) {
          var key = op.method + ' ' + op.path
          var value = requestBodyValue(ui, op)
          if (value !== lastSeen[key]) {
            lastSeen[key] = value
            var serialized = serializeBodyValue(value)
            if (serialized === undefined) return
            writeStored(op.method, op.path, serialized)
            log('captured', op.method, op.path)
          }
        })
      })

      log('attached, watching', initialOps.length, 'operations, token', TOKEN)
    })
  }

  window.addEventListener('load', function () {
    // Read these here, not at top-level script parse time: this file is
    // loaded via a blocking <script src> (customJs) that swagger-ui-express
    // renders *before* the inline <script> (customJsStr) that sets these
    // globals, so they don't exist yet when this file's own top level runs.
    TOKEN = typeof window.__SWAGGER_STORAGE_TOKEN__ === 'string' ? window.__SWAGGER_STORAGE_TOKEN__ : null
    DEBUG = !!window.__SWAGGER_STORAGE_DEBUG__

    if (window.ui) {
      attach(window.ui)
    } else {
      console.warn('[swagger-storage] window.ui was not found on page load — this page may not be using swagger-ui-express.')
    }
  })
})()
