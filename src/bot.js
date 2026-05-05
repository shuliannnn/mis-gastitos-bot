'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { parseMessage, helpMessage } = require('./parser');
const { appendRow, getMonthlySummary } = require('./sheets');

const AUTHORIZED_NUMBER = process.env.AUTHORIZED_NUMBER;

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  const isFromMe = message.key.fromMe;

  // Solo procesar mensajes del número autorizado (y no los propios enviados por el bot)
  if (isFromMe) return;
  if (jid !== AUTHORIZED_NUMBER) {
    console.log(`[Bot] Mensaje ignorado de número no autorizado: ${jid}`);
    return;
  }

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
    await appendRow(transaccion);
    const montoFormateado = transaccion.monto.toLocaleString('es-AR');
    const respuesta =
      transaccion.tipo === 'Gasto'
        ? `✅ Gasto de $${montoFormateado} en ${transaccion.categoria} registrado.`
        : `✅ Ingreso de $${montoFormateado} en ${transaccion.categoria} registrado.`;
    await sock.sendMessage(jid, { text: respuesta });
    console.log(`[Bot] Registrado: ${transaccion.tipo} $${transaccion.monto} - ${transaccion.categoria}`);
  } catch (err) {
    console.error('[Bot] Error al guardar en Sheets:', err);
    await sock.sendMessage(jid, { text: '❌ Error al guardar el registro. Revisá los logs.' });
  }
}

async function handleResumen(sock, jid) {
  try {
    const { ingresos, gastos, balance } = await getMonthlySummary();
    const mes = new Date().toLocaleString('es-AR', { month: 'long', year: 'numeric' });
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

  function connect() {
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('[Bot] Escaneá este QR con WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('[Bot] Conectado a WhatsApp ✅');
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[Bot] Conexión cerrada. Reconectando:', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(connect, 3000);
        } else {
          console.log('[Bot] Sesión cerrada. Eliminá auth_info_baileys/ y reiniciá.');
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        await handleMessage(sock, msg);
      }
    });

    return sock;
  }

  connect();
}

module.exports = { startBot };
