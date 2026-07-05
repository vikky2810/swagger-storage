# swagger-storage

Persist the request bodies you type into Swagger UI's "Try it out" panel, and automatically re-seed them the next time you open the docs — across page refreshes and server restarts.

Values are stored in the browser's `localStorage`, namespaced by a token unique to your project (generated automatically on `npm install`), so multiple Swagger projects served from the same origin/port never mix up each other's data.

## Install

```sh
npm install swagger-storage
```

On install, a `postinstall` script generates a unique token and writes it to your `package.json`:

```json
{
  "swaggerStorage": {
    "token": "b3f1c9d2-..."
  }
}
```

Commit this. It's what gives your project a stable identity in `localStorage`.

## Usage

Drop-in replacement for `swagger-ui-express`:

```js
const express = require('express')
const swaggerStorage = require('swagger-storage/express')
const swaggerDocument = require('./swagger.json')

const app = express()
app.use('/api-docs', swaggerStorage.serve, swaggerStorage.setup(swaggerDocument))

app.listen(3000)
```

That's it. Type a value into a request body field under "Try it out," refresh the page (or restart the server), and it comes back.

## How it works

- `setup()` reads your project's token from `package.json` and injects it into the Swagger UI page, along with a small browser script.
- That script watches Swagger UI's internal state for request-body changes and writes them to `localStorage` under a key like `swagger-storage:<token>:<method>:<path>`.
- On page load, it reads back any saved values for the current spec's operations and re-seeds them into Swagger UI before you interact with the page.

## Options

`setup()` has the same signature as `swagger-ui-express`'s `setup()` — pass a `swaggerOptions` object as usual. One extra option:

```js
swaggerStorage.setup(swaggerDocument, {
  swaggerStorageToken: 'custom-token' // overrides the token read from package.json
})
```

## Scope (v1)

- Only `swagger-ui-express` is supported (not `swagger-ui-react` or plain CDN embeds).
- Only the request body is persisted — not query/path parameters, headers, auth, or the selected server/content-type.
- Storage is `localStorage`, so it's per-browser, per-origin. Data doesn't sync across machines or browsers.

## Requirements

- `swagger-ui-express` >= 4 as a peer dependency.
- npm (the postinstall token generation relies on `INIT_CWD`, which is npm-specific; pnpm/yarn users can set `swaggerStorage.token` in `package.json` manually, or pass `swaggerStorageToken` explicitly).

## License

MIT
