'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PACKAGE_NAME = require('../package.json').name

/**
 * Directory of *this* package (swagger-storage itself), used to guard against
 * the postinstall script mutating its own package.json when it's installed
 * as a dependency of some other tool, or when someone runs `npm install`
 * inside this repo during development.
 */
const SELF_DIR = path.resolve(__dirname, '..')

/**
 * npm sets INIT_CWD to the directory `npm install` was originally invoked
 * from — unlike process.cwd(), which inside a postinstall script points at
 * this package's own install location inside node_modules.
 */
function resolveConsumerDir() {
  const initCwd = process.env.INIT_CWD
  if (!initCwd) return null
  return path.resolve(initCwd)
}

function isSelfInstall(consumerDir) {
  if (!consumerDir) return true
  if (consumerDir === SELF_DIR) return true
  const consumerPkgPath = path.join(consumerDir, 'package.json')
  if (!fs.existsSync(consumerPkgPath)) return true
  try {
    const pkg = JSON.parse(fs.readFileSync(consumerPkgPath, 'utf8'))
    return pkg.name === PACKAGE_NAME
  } catch {
    return true
  }
}

/**
 * Idempotently ensures the consumer's package.json has a
 * `swaggerStorage.token`. Safe to call repeatedly (e.g. on every install) —
 * a no-op once the token exists. Never throws; returns null on any failure
 * so postinstall can warn instead of breaking the consumer's `npm install`.
 */
function ensureToken() {
  const consumerDir = resolveConsumerDir()
  if (isSelfInstall(consumerDir)) return null

  const pkgPath = path.join(consumerDir, 'package.json')
  let raw
  try {
    raw = fs.readFileSync(pkgPath, 'utf8')
  } catch {
    return null
  }

  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch {
    return null
  }

  if (pkg.swaggerStorage && pkg.swaggerStorage.token) {
    return pkg.swaggerStorage.token
  }

  const token = crypto.randomUUID()
  pkg.swaggerStorage = Object.assign({}, pkg.swaggerStorage, { token })

  const hadTrailingNewline = raw.endsWith('\n')
  const indent = detectIndent(raw)
  const next = JSON.stringify(pkg, null, indent) + (hadTrailingNewline ? '\n' : '')

  try {
    fs.writeFileSync(pkgPath, next)
  } catch {
    return null
  }

  return token
}

function detectIndent(raw) {
  const match = raw.match(/^([ \t]+)"/m)
  return match ? match[1] : 2
}

function tokenFromPackageJsonIn(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return (pkg.swaggerStorage && pkg.swaggerStorage.token) || null
  } catch {
    return null
  }
}

/**
 * Reads the project token at runtime (used by the Express integration).
 * Tries `dir` (normally process.cwd()) first, then falls back to the
 * directory of the running process's entry script — `process.cwd()` isn't
 * always the project root (IDE run configs, pm2, systemd, etc. frequently
 * launch `node` from a different directory than the script's own folder).
 */
function readToken(dir) {
  const fromDir = tokenFromPackageJsonIn(dir || process.cwd())
  if (fromDir) return fromDir

  if (require.main && require.main.filename) {
    const fromEntryScript = tokenFromPackageJsonIn(path.dirname(require.main.filename))
    if (fromEntryScript) return fromEntryScript
  }

  return null
}

module.exports = { ensureToken, readToken, resolveConsumerDir, isSelfInstall }
