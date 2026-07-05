'use strict'

const path = require('path')
const express = require('express')
const swaggerUiExpress = require('swagger-ui-express')
const { readToken } = require('./token')

const ASSET_MOUNT = '__swagger-storage__'
const BUNDLE_PATH = path.join(__dirname, '..', 'dist', 'persist.global.js')

function assetMiddleware() {
  const router = express.Router()
  router.get('/' + ASSET_MOUNT + '/persist.js', (req, res, next) => {
    res.set('Content-Type', 'application/javascript')
    // Never let the browser cache this — it's tiny, and a stale cached copy
    // after a swagger-storage upgrade silently reintroduces fixed bugs.
    res.set('Cache-Control', 'no-store, must-revalidate')
    res.sendFile(BUNDLE_PATH, (err) => {
      if (err) next(err)
    })
  })
  return router
}

/**
 * Drop-in replacement for swagger-ui-express's `serve` middleware array —
 * adds a route for our injected browser bundle alongside the normal
 * swagger-ui static assets.
 */
const serve = [assetMiddleware()].concat(swaggerUiExpress.serve)

function mergeToArray(existing, addition) {
  if (existing == null) return [addition]
  if (Array.isArray(existing)) return existing.concat([addition])
  return [existing, addition]
}

/**
 * Drop-in replacement for swagger-ui-express's `setup` — same signature,
 * but wires in the per-project token and the persistence bundle via
 * customJs/customJsStr. The project token is read from the running
 * process's package.json (process.cwd(), i.e. wherever the server was
 * started from) unless overridden via `opts.swaggerStorageToken`.
 */
function setup(swaggerDoc, opts, ...rest) {
  opts = Object.assign({}, opts)

  const token = opts.swaggerStorageToken || readToken(process.cwd())
  delete opts.swaggerStorageToken

  if (!token) {
    console.warn(
      '[swagger-storage] no token found near ' + process.cwd() + ' or the entry script\'s ' +
      'directory — persistence will be disabled for this session. Make sure `npm install` ' +
      'has run in your project (it writes swaggerStorage.token to package.json), or pass ' +
      'swaggerStorageToken explicitly to setup().'
    )
  }
  const debug = !!opts.swaggerStorageDebug
  delete opts.swaggerStorageDebug

  const tokenScript = 'window.__SWAGGER_STORAGE_TOKEN__ = ' + JSON.stringify(token) + ';' +
    (debug ? 'window.__SWAGGER_STORAGE_DEBUG__ = true;' : '')
  opts.customJsStr = mergeToArray(opts.customJsStr, tokenScript)
  opts.customJs = mergeToArray(opts.customJs, './' + ASSET_MOUNT + '/persist.js')

  return swaggerUiExpress.setup(swaggerDoc, opts, ...rest)
}

module.exports = { serve, setup }
