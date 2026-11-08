'use strict';
const {suite} = require('./suite');
const {memoryStore} = require('../src/store-memory');
suite('memory', async () => memoryStore());
