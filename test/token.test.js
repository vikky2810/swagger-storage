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

function makeRawProject(prefix, raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.writeFileSync(path.join(dir, 'package.json'), raw)
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

test('ensureToken does not inject blank lines when package.json contains one', () => {
  const dir = makeRawProject(
    'swagger-storage-test-blank-',
    '{\n\n  "name": "blank-line-project",\n  "version": "1.0.0"\n}\n'
  )
  withInitCwd(dir, () => {
    const token = ensureToken()
    const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    assert.ok(
      !/\n[ \t]*\n/.test(after.trim()),
      'blank lines were injected between keys:\n' + after
    )
    assert.equal(JSON.parse(after).name, 'blank-line-project')
    assert.equal(JSON.parse(after).swaggerStorage.token, token)
    assert.match(after, /\n  "version":/, 'top-level indentation should stay at two spaces')
    assert.match(after, /\n    "token":/, 'nested indentation should stay at four spaces')
  })
})

test('ensureToken does not inject blank lines on a CRLF package.json', () => {
  // git's core.autocrlf leaves plenty of Windows checkouts with \r\n endings.
  // JSON.stringify always emits \n, so the rewrite normalizes endings either
  // way; what's asserted here is only that no blank lines get injected.
  const dir = makeRawProject(
    'swagger-storage-test-crlf-',
    '{\r\n\r\n  "name": "crlf-project",\r\n  "version": "1.0.0"\r\n}\r\n'
  )
  withInitCwd(dir, () => {
    ensureToken()
    const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    assert.ok(
      !/\n[ \t\r]*\n/.test(after.trim()),
      'blank lines were injected between keys:\n' + after
    )
    assert.equal(JSON.parse(after).name, 'crlf-project')
  })
})

test('ensureToken preserves tab indentation', () => {
  const dir = makeRawProject(
    'swagger-storage-test-tab-',
    JSON.stringify({ name: 'tab-project', version: '1.0.0' }, null, '\t') + '\n'
  )
  withInitCwd(dir, () => {
    ensureToken()
    const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    assert.match(after, /\n\t"version":/)
    assert.match(after, /\n\t\t"token":/)
  })
})

test('ensureToken preserves four-space indentation', () => {
  const dir = makeRawProject(
    'swagger-storage-test-four-',
    JSON.stringify({ name: 'four-space-project', version: '1.0.0' }, null, 4) + '\n'
  )
  withInitCwd(dir, () => {
    ensureToken()
    const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    assert.match(after, /\n    "version":/)
    assert.match(after, /\n        "token":/)
  })
})

test('ensureToken falls back to two spaces for a minified package.json', () => {
  const dir = makeRawProject(
    'swagger-storage-test-min-',
    '{"name":"minified-project","version":"1.0.0"}'
  )
  withInitCwd(dir, () => {
    const token = ensureToken()
    const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    assert.equal(JSON.parse(after).swaggerStorage.token, token)
    assert.match(after, /\n  "version":/)
  })
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
