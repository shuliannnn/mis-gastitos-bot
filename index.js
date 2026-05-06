'use strict';

require('dotenv').config();
const fs = require('fs');

// En Railway, credentials.json se pasa como base64 en GOOGLE_CREDENTIALS_B64
if (process.env.GOOGLE_CREDENTIALS_B64 && !fs.existsSync('./credentials.json')) {
  fs.writeFileSync('./credentials.json', Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8'));
  console.log('[Init] credentials.json generado desde variable de entorno.');
}

const { startBot } = require('./src/bot');

startBot().catch((err) => {
  console.error('[Index] Error fatal:', err);
  process.exit(1);
});
