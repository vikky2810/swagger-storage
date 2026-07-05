'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

function withTempProjectCwd(pkgExtra, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swagger-storage-express-test-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(Object.assign({ name: 'temp' }, pkgExtra)))
  const prevCwd = process.cwd()
  process.chdir(dir)
  try {
    return fn(dir)
  } finally {
    process.chdir(prevCwd)
  }
}

function renderSetup(setup, spec, opts) {
  const middleware = setup(spec, opts)
  let sentHtml = null
  middleware({}, { send: (html) => { sentHtml = html } })
  return sentHtml
}

test('setup() injects the project token and persist.js script, merging existing customJs/customJsStr', () => {
  withTempProjectCwd({ swaggerStorage: { token: 'test-token-123' } }, () => {
    const { setup } = require('../src/express')
    const html = renderSetup(setup, { openapi: '3.0.0', info: {}, paths: {} }, {
      customJsStr: 'window.userScript = true;',
      customJs: 'https://example.com/user.js'
    })

    assert.match(html, /window\.__SWAGGER_STORAGE_TOKEN__ = "test-token-123";/)
    assert.match(html, /window\.userScript = true;/)
    assert.match(html, /__swagger-storage__\/persist\.js/)
    assert.match(html, /https:\/\/example\.com\/user\.js/)
  })
})

test('setup() falls back to a null token when none is configured', () => {
  withTempProjectCwd({}, () => {
    const { setup } = require('../src/express')
    const html = renderSetup(setup, { openapi: '3.0.0', info: {}, paths: {} })
    assert.match(html, /window\.__SWAGGER_STORAGE_TOKEN__ = null;/)
  })
})

test('setup() honors an explicit swaggerStorageToken override', () => {
  const { setup } = require('../src/express')
  const html = renderSetup(setup, { openapi: '3.0.0', info: {}, paths: {} }, { swaggerStorageToken: 'override-token' })
  assert.match(html, /window\.__SWAGGER_STORAGE_TOKEN__ = "override-token";/)
})

test('serve is an array of middleware including the persist.js asset route', () => {
  const { serve } = require('../src/express')
  assert.ok(Array.isArray(serve))
  assert.ok(serve.length > 0)
})
