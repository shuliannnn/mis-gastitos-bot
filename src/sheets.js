'use strict';

const { google } = require('googleapis');
const path = require('path');

const SHEET_NAME = 'Registros';
const HEADERS = ['Fecha', 'Hora', 'Tipo', 'Monto', 'Categoría', 'Descripción'];

function getAuth() {
  const credentialsPath = path.resolve(process.env.CREDENTIALS_PATH || './credentials.json');
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function ensureSheetExists(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(
    (s) => s.properties.title === SHEET_NAME
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
    // Escribir encabezados
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    console.log(`[Sheets] Hoja "${SHEET_NAME}" creada con encabezados.`);
  }
}

/**
 * Agrega una fila con la transacción al sheet.
 * @param {{ tipo: string, monto: number, categoria: string, descripcion: string }} transaccion
 */
async function appendRow(transaccion) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;

  await ensureSheetExists(sheets, spreadsheetId);

  const now = new Date();
  const fecha = now.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const hora = now.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit',
  });

  const row = [
    fecha,
    hora,
    transaccion.tipo,
    transaccion.monto,
    transaccion.categoria,
    transaccion.descripcion || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * Lee todas las filas del sheet y devuelve los totales del mes actual.
 * @returns {{ ingresos: number, gastos: number, balance: number }}
 */
async function getMonthlySummary() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;

  await ensureSheetExists(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = res.data.values || [];
  const now = new Date();
  const mesActual = now.getMonth();
  const anioActual = now.getFullYear();

  let ingresos = 0;
  let gastos = 0;

  for (const row of rows) {
    const [fechaStr, , tipo, montoStr] = row;
    if (!fechaStr || !tipo || !montoStr) continue;

    // Fecha formato DD/MM/YYYY
    const partes = fechaStr.split('/');
    if (partes.length !== 3) continue;
    const fecha = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`);
    if (fecha.getMonth() !== mesActual || fecha.getFullYear() !== anioActual) continue;

    const monto = parseFloat(montoStr);
    if (isNaN(monto)) continue;

    if (tipo === 'Ingreso') ingresos += monto;
    else if (tipo === 'Gasto') gastos += monto;
  }

  return { ingresos, gastos, balance: ingresos - gastos };
}

module.exports = { appendRow, getMonthlySummary };
