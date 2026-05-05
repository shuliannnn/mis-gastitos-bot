'use strict';

require('dotenv').config();
const { startBot } = require('./src/bot');

startBot().catch((err) => {
  console.error('[Index] Error fatal:', err);
  process.exit(1);
});
