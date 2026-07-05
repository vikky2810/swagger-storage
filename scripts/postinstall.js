'use strict'

const { ensureToken } = require('../src/token')

try {
  const token = ensureToken()
  if (token) {
    console.log(`[swagger-storage] project token ready (${token.slice(0, 8)}...)`)
  }
} catch (err) {
  // Never fail the consumer's `npm install` over this.
  console.warn('[swagger-storage] postinstall skipped:', err.message)
}
