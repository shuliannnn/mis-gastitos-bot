'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const http = require('http');
const { parseMessage, helpMessage } = require('./parser');
const { appendRow, getMonthlySummary, updateEstadisticas } = require('./sheets');
const { categorize } = require('./categorizer');


const AUTHORIZED_NUMBER = process.env.AUTHORIZED_NUMBER;

// Servidor HTTP para mostrar el QR en el navegador (necesario en Railway)
let currentQR = null;
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (currentQR) {
    const img = await QRCode.toDataURL(currentQR, { width: 300 });
    res.end(`<!DOCTYPE html><html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f0f0f;color:#fff;font-family:sans-serif"><h2>📱 Escaneá con WhatsApp</h2><img src="${img}" style="border-radius:12px"/><p style="color:#aaa;margin-top:16px">Actualizá la página si el QR venció</p></body></html>`);
  } else {
    res.end(`<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f0f0f;color:#4caf50;font-family:sans-serif"><h2>✅ Bot conectado a WhatsApp</h2></body></html>`);
  }
}).listen(PORT, () => console.log(`[Bot] Servidor QR en puerto ${PORT}`));

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;

  if (jid !== AUTHORIZED_NUMBER) return;

  const text =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    '';

  if (!text) return;

  console.log(`[Bot] Mensaje recibido: "${text}"`);

  const normalized = text.trim().toLowerCase();

  if (normalized === 'resumen') {
    await handleResumen(sock, jid);
    return;
  }

  const transaccion = parseMessage(text);

  if (!transaccion) {
    await sock.sendMessage(jid, { text: helpMessage() });
    return;
  }

  try {
    transaccion.categoria = await categorize(transaccion.descripcion, transaccion.tipo);
    await appendRow(transaccion);
    const montoFormateado = transaccion.monto.toLocaleString('es-AR');
    const respuesta =
      transaccion.tipo === 'Gasto'
        ? `✅ *$${montoFormateado}* — ${transaccion.descripcion}\n🏷 Categoría: ${transaccion.categoria}`
        : `✅ *$${montoFormateado}* — ${transaccion.descripcion}\n🏷 Categoría: ${transaccion.categoria}`;
    await sock.sendMessage(jid, { text: respuesta });
    console.log(`[Bot] Registrado: ${transaccion.tipo} $${transaccion.monto} - ${transaccion.categoria}`);
    // Actualizar estadísticas en segundo plano sin bloquear
    updateEstadisticas().catch(err => console.error('[Bot] Error actualizando estadísticas:', err.message));
  } catch (err) {
    console.error('[Bot] Error al guardar en Sheets:', err);
    await sock.sendMessage(jid, { text: '❌ Error al guardar el registro. Revisá los logs.' });
  }
}

async function handleResumen(sock, jid) {
  try {
    const { ingresos, gastos, balance } = await getMonthlySummary();
    const now = new Date();
    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const mes = `${MESES[now.getMonth()]} ${now.getFullYear()}`;
    const signo = balance >= 0 ? '+' : '';
    const texto =
      `📊 *Resumen de ${mes}*\n\n` +
      `💰 Ingresos: $${ingresos.toLocaleString('es-AR')}\n` +
      `💸 Gastos: $${gastos.toLocaleString('es-AR')}\n` +
      `📈 Balance: ${signo}$${balance.toLocaleString('es-AR')}`;
    await sock.sendMessage(jid, { text: texto });
  } catch (err) {
    console.error('[Bot] Error al calcular resumen:', err);
    await sock.sendMessage(jid, { text: '❌ Error al calcular el resumen. Revisá los logs.' });
  }
}

async function startBot() {
  if (!AUTHORIZED_NUMBER) {
    console.error('[Bot] AUTHORIZED_NUMBER no definido en .env');
    process.exit(1);
  }
  if (!process.env.SHEET_ID) {
    console.error('[Bot] SHEET_ID no definido en .env');
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[Bot] Usando Baileys v${version.join('.')}`);

  // Cache de mensajes para ayudar a descifrar retries
  const msgCache = new Map();
  let reconnectDelay = 3000;

  function connect() {
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      syncFullHistory: false,
      keepAliveIntervalMs: 30000,
      connectTimeoutMs: 60000,
      getMessage: async (key) => {
        const id = `${key.remoteJid}-${key.id}`;
        return msgCache.get(id) || { conversation: '' };
      },
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        currentQR = qr;
        console.log(`[Bot] QR listo — abrí la URL pública de Railway en el navegador para escanearlo`);
      }

      if (connection === 'open') {
        currentQR = null;
        reconnectDelay = 3000;
        console.log('[Bot] Conectado a WhatsApp ✅');
        updateEstadisticas().catch(err => console.error('[Bot] Error sync inicial:', err.message));
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[Bot] Conexión cerrada (${statusCode}). Reconectando: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 60000); // backoff hasta 60s
        } else {
          console.log('[Bot] Sesión cerrada. Eliminá auth_info_baileys/ y reiniciá.');
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const jid = msg.key?.remoteJid || '';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (text) console.log(`[MSG] jid=${jid} texto="${text}"`);
        if (msg.key?.id && jid) msgCache.set(`${jid}-${msg.key.id}`, msg.message);
        await handleMessage(sock, msg);
      }
    });

    return sock;
  }

  connect();
}

module.exports = { startBot };
