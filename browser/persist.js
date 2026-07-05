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
        ui.oas3Actions.setRequestBodyValue({ value: saved, pathMethod: pathMethod })
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
            writeStored(op.method, op.path, value)
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
