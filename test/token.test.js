'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ensureToken, readToken } = require('../src/token')

function makeTempProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swagger-storage-test-'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: name || 'temp-project', version: '1.0.0' }, null, 2) + '\n'
  )
  return dir
}

function withInitCwd(dir, fn) {
  const prev = process.env.INIT_CWD
  process.env.INIT_CWD = dir
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.INIT_CWD
    else process.env.INIT_CWD = prev
  }
}

test('ensureToken writes a token into a fresh consumer package.json', () => {
  const dir = makeTempProject()
  withInitCwd(dir, () => {
    const token = ensureToken()
    assert.ok(token, 'expected a token to be generated')
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.swaggerStorage.token, token)
  })
})

test('ensureToken is idempotent', () => {
  const dir = makeTempProject()
  withInitCwd(dir, () => {
    const first = ensureToken()
    const second = ensureToken()
    assert.equal(first, second)
  })
})

test('ensureToken skips a project literally named swagger-storage (self-install guard)', () => {
  const dir = makeTempProject('swagger-storage')
  withInitCwd(dir, () => {
    const token = ensureToken()
    assert.equal(token, null)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.swaggerStorage, undefined)
  })
})

test('ensureToken skips when INIT_CWD is unset', () => {
  const prev = process.env.INIT_CWD
  delete process.env.INIT_CWD
  try {
    assert.equal(ensureToken(), null)
  } finally {
    if (prev !== undefined) process.env.INIT_CWD = prev
  }
})

test('readToken reads back a written token', () => {
  const dir = makeTempProject()
  withInitCwd(dir, () => {
    const token = ensureToken()
    assert.equal(readToken(dir), token)
  })
})

test('readToken returns null when there is no package.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swagger-storage-test-empty-'))
  assert.equal(readToken(dir), null)
})

test('readToken falls back to the entry script\'s directory when cwd has no token', () => {
  // Reproduces launching `node <project>/server.js` from an unrelated cwd
  // (IDE run configs / process managers often do this).
  const execFileSync = require('node:child_process').execFileSync
  const projectDir = makeTempProject('entry-fallback-project')
  const cwdWithoutToken = fs.mkdtempSync(path.join(os.tmpdir(), 'swagger-storage-test-cwd-'))
  withInitCwd(projectDir, () => { ensureToken() })
  const expectedToken = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')).swaggerStorage.token

  const entryScript = path.join(projectDir, 'entry.js')
  fs.writeFileSync(
    entryScript,
    `console.log(require(${JSON.stringify(path.join(__dirname, '..', 'src', 'token'))}).readToken())`
  )

  const output = execFileSync(process.execPath, [entryScript], { cwd: cwdWithoutToken }).toString().trim()
  assert.equal(output, expectedToken)
})
