'use strict'

const express = require('express')
const swaggerStorage = require('swagger-storage')
const spec = require('./spec.json')

const app = express()
app.use('/api-docs', swaggerStorage.serve, swaggerStorage.setup(spec))

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Example app running at http://localhost:${port}/api-docs`))
