'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const Immutable = require('immutable')

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'browser', 'persist.js'), 'utf8')
const TOKEN = 'test-token'
const KEY = 'swagger-storage:' + TOKEN + ':post:/login'

function fakeLocalStorage(initial) {
  const data = new Map(Object.entries(initial || {}))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k)
  }
}

/**
 * Minimal stand-in for the Swagger UI system, backed by real Immutable state.
 * setRequestBodyValue mirrors swagger-ui 5's reducer: a Map payload is
 * { field: value } and each field is stored as { field: { value } }.
 */
function fakeUi() {
  let state = Immutable.Map()
  const listeners = []
  const bodyPath = (p, m) => ['requestData', p, m, 'bodyValue']
  const dispatch = (next) => {
    state = next
    listeners.forEach((fn) => fn())
  }
  return {
    getState: () => state,
    getStore: () => ({ subscribe: (fn) => listeners.push(fn) }),
    specSelectors: {
      paths: () => Immutable.fromJS({ '/login': { post: {} } })
    },
    oas3Selectors: {
      requestBodyValue: (p, m) => state.getIn(bodyPath(p, m))
    },
    setBody: (p, m, value) => dispatch(state.setIn(bodyPath(p, m), value)),
    oas3Actions: {
      setRequestBodyValue: ({ value, pathMethod }) => {
        const key = bodyPath(...pathMethod)
        if (!Immutable.Map.isMap(value)) return dispatch(state.setIn(key, value))
        let body = state.getIn(key)
        if (!Immutable.Map.isMap(body)) body = Immutable.Map()
        value.keySeq().forEach((name) => {
          const v = value.get(name)
          if (!(body.has(name) && Immutable.Map.isMap(v))) body = body.setIn([name, 'value'], v)
        })
        dispatch(state.setIn(key, body))
      },
      setRetainRequestBodyValueFlag: () => {}
    }
  }
}

/** Runs persist.js against a fake page and resolves once it has attached. */
async function loadPage(localStorage) {
  const ui = fakeUi()
  let onLoad
  const window = {
    localStorage,
    ui,
    __SWAGGER_STORAGE_TOKEN__: TOKEN,
    addEventListener: (type, fn) => { if (type === 'load') onLoad = fn }
  }
  vm.runInNewContext(SCRIPT, { window, console, setInterval, clearInterval })
  onLoad()
  await new Promise((resolve) => setTimeout(resolve, 150))
  return ui
}

function form(fields) {
  return Immutable.fromJS(fields)
}

test('form body is saved as JSON and restored as an Immutable Map', async () => {
  const storage = fakeLocalStorage()
  let ui = await loadPage(storage)
  ui.oas3Actions.setRequestBodyValue({ value: form({ username: 'vikram', password: 'secret123' }), pathMethod: ['/login', 'post'] })

  assert.equal(storage.getItem(KEY), 'swagger-storage-form:{"username":"vikram","password":"secret123"}')

  ui = await loadPage(storage)
  const restored = ui.oas3Selectors.requestBodyValue('/login', 'post')
  assert.deepEqual(restored.toJS(), { username: { value: 'vikram' }, password: { value: 'secret123' } })
})

test('array fields round-trip as Immutable Lists', async () => {
  const storage = fakeLocalStorage()
  let ui = await loadPage(storage)
  ui.oas3Actions.setRequestBodyValue({ value: form({ tags: ['a', 'b'] }), pathMethod: ['/login', 'post'] })

  ui = await loadPage(storage)
  const tags = ui.oas3Selectors.requestBodyValue('/login', 'post').getIn(['tags', 'value'])
  assert.ok(Immutable.List.isList(tags))
  assert.deepEqual(tags.toJS(), ['a', 'b'])
})

test('file fields and validation errors are not stored', async () => {
  const storage = fakeLocalStorage()
  const ui = await loadPage(storage)
  const value = Immutable.fromJS({ name: { value: 'avatar', errors: ['bad'] } })
    .setIn(['file', 'value'], { name: 'photo.png', size: 10 })
  ui.setBody('/login', 'post', value)

  assert.equal(storage.getItem(KEY), 'swagger-storage-form:{"name":"avatar"}')
})

test('a form with only file fields removes the stored entry', async () => {
  const storage = fakeLocalStorage({ [KEY]: 'swagger-storage-form:{"name":"old"}' })
  const ui = await loadPage(storage)
  ui.setBody('/login', 'post', Immutable.Map().setIn(['file', 'value'], { name: 'photo.png' }))

  assert.equal(storage.getItem(KEY), null)
})

test('string bodies are still stored and restored as-is', async () => {
  const storage = fakeLocalStorage()
  let ui = await loadPage(storage)
  ui.oas3Actions.setRequestBodyValue({ value: '{"a":1}', pathMethod: ['/login', 'post'] })
  assert.equal(storage.getItem(KEY), '{"a":1}')

  ui = await loadPage(storage)
  assert.equal(ui.oas3Selectors.requestBodyValue('/login', 'post'), '{"a":1}')
})

test('unreadable form values saved by 0.1.1 are dropped instead of restored', async () => {
  const storage = fakeLocalStorage({ [KEY]: 'Map { "username": Map { "value": "vikram" } }' })
  const ui = await loadPage(storage)

  assert.equal(ui.oas3Selectors.requestBodyValue('/login', 'post'), undefined)
  assert.equal(storage.getItem(KEY), null)
})
