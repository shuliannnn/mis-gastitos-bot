'use strict';

const { google } = require('googleapis');
const path = require('path');

const SHEET_REGISTROS = 'Registros';
const SHEET_ESTADISTICAS = 'Estadísticas';
// Orden: Día | Tipo | Descripción | Monto | Categoría | Método de Pago
const HEADERS = ['Día', 'Tipo', 'Descripción', 'Monto', 'Categoría', 'Método de Pago'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function getMonthlySheetName(date = new Date()) {
  return `${MESES[date.getMonth()]} ${date.getFullYear()}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function getAuth() {
  const credentialsPath = path.resolve(process.env.CREDENTIALS_PATH || './credentials.json');
  return new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheetsClient() {
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function getMeta(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  return res.data;
}

function headerColor(isStats) {
  return isStats
    ? { red: 0.8, green: 0.93, blue: 0.83 }   // verde pastel
    : { red: 0.8, green: 0.88, blue: 0.97 };   // azul pastel
}

async function formatDataSheet(sheets, spreadsheetId, sheetId, isStats = false) {
  const colWidths = isStats
    ? []
    : [110, 80, 260, 110, 160, 140]; // Día Tipo Descripción Monto Categoría Método

  const requests = [
    // Congelar fila 1
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Encabezado: fondo de color + texto blanco + negrita + centrado
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: headerColor(isStats),
            textFormat: { bold: true, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 }, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Altura de fila del encabezado
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 32 },
        fields: 'pixelSize',
      },
    },
    // Formato fecha en columna A (Día)
    ...(!isStats ? [{
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }] : []),
    // Formato moneda en columna D (Monto)
    ...(!isStats ? [{
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }] : []),
    // Anchos de columna
    ...colWidths.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    })),
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

// Asegura que la hoja exista. Devuelve su sheetId numérico.
async function ensureSheet(sheets, spreadsheetId, title, withHeaders = true) {
  const meta = await getMeta(sheets, spreadsheetId);
  const existing = meta.sheets.find(s => s.properties.title === title);
  if (existing) return existing.properties.sheetId;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const newSheetId = res.data.replies[0].addSheet.properties.sheetId;

  if (withHeaders) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    await formatDataSheet(sheets, spreadsheetId, newSheetId, title === SHEET_ESTADISTICAS);
    if (title !== SHEET_ESTADISTICAS) {
      await applyConditionalFormatting(sheets, spreadsheetId, newSheetId);
    }
  }

  console.log(`[Sheets] Hoja "${title}" creada.`);
  return newSheetId;
}

async function readRows(sheets, spreadsheetId, title) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'!A2:F`,
    });
    return res.data.values || [];
  } catch {
    return [];
  }
}

async function appendRow(transaccion) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const now = new Date();

  const fecha = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const monthlySheet = getMonthlySheetName(now);

  await ensureSheet(sheets, spreadsheetId, SHEET_REGISTROS);
  await ensureSheet(sheets, spreadsheetId, monthlySheet);

  const row = [
    fecha,
    transaccion.tipo,
    transaccion.descripcion || '',
    transaccion.monto,
    transaccion.categoria,
    transaccion.metodoPago || '',
  ];

  for (const sheet of [SHEET_REGISTROS, monthlySheet]) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheet}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  }
}

async function getMonthlySummary() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const monthlySheet = getMonthlySheetName();

  await ensureSheet(sheets, spreadsheetId, SHEET_REGISTROS);
  await ensureSheet(sheets, spreadsheetId, monthlySheet);

  const rows = await readRows(sheets, spreadsheetId, monthlySheet);
  let ingresos = 0, gastos = 0;

  for (const [, tipo, , montoStr] of rows) {
    if (!tipo || !montoStr) continue;
    const m = parseFloat(montoStr);
    if (isNaN(m)) continue;
    if (tipo === 'Ingreso') ingresos += m;
    else if (tipo === 'Gasto') gastos += m;
  }

  return { ingresos, gastos, balance: ingresos - gastos };
}

const CAT_COLORS = {
  'Comida':        { red: 1.00, green: 0.87, blue: 0.68 },
  'Supermercado':  { red: 0.78, green: 0.92, blue: 0.78 },
  'Farmacia':      { red: 1.00, green: 0.80, blue: 0.80 },
  'Costo Fijo':    { red: 0.80, green: 0.80, blue: 0.95 },
  'Auto':          { red: 0.87, green: 0.87, blue: 0.87 },
  'Ocio':          { red: 0.95, green: 0.78, blue: 0.95 },
  'Deporte':       { red: 0.73, green: 0.90, blue: 0.97 },
  'Hogar':         { red: 0.97, green: 0.93, blue: 0.73 },
  'Servicios':     { red: 0.92, green: 0.87, blue: 0.77 },
  'Salud':         { red: 0.78, green: 0.95, blue: 0.87 },
  'Educación':     { red: 0.73, green: 0.85, blue: 0.97 },
  'Salidas':       { red: 0.99, green: 0.82, blue: 0.70 },
  'Compras':       { red: 0.95, green: 0.88, blue: 0.97 },
  'Suscripciones': { red: 0.88, green: 0.78, blue: 0.97 },
  'Otros':         { red: 0.93, green: 0.93, blue: 0.93 },
};

const CATEGORIES = Object.keys(CAT_COLORS);

async function applyConditionalFormatting(sheets, spreadsheetId, sheetId, cachedMeta = null) {
  const meta = cachedMeta || await getMeta(sheets, spreadsheetId);
  const sheetMeta = meta.sheets.find(s => s.properties.sheetId === sheetId);
  const ruleCount = sheetMeta?.conditionalFormats?.length || 0;

  const requests = [];

  // Eliminar reglas existentes (de atrás para adelante por índice)
  for (let i = ruleCount - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  // Dropdown para seleccionar categoría (col E = índice 4)
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: CATEGORIES.map(c => ({ userEnteredValue: c })),
        },
        showCustomUi: true,
        strict: false,
      },
    },
  });

  // Formato condicional: color de fila según categoría
  CATEGORIES.forEach((cat, idx) => {
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 }],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=$E2="${cat}"` }],
            },
            format: { backgroundColor: CAT_COLORS[cat] },
          },
        },
        index: idx,
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function updateEstadisticas() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;

  const meta = await getMeta(sheets, spreadsheetId);
  const allSheets = meta.sheets;

  // Refrescar formato condicional + dropdown en hojas de datos activas
  const dataSheetTitles = [SHEET_REGISTROS, getMonthlySheetName()];
  for (const title of dataSheetTitles) {
    const s = allSheets.find(sh => sh.properties.title === title);
    if (s) {
      await applyConditionalFormatting(sheets, spreadsheetId, s.properties.sheetId, meta).catch(() => {});
    }
  }

  const monthlyPattern = new RegExp(`^(${MESES.join('|')}) \\d{4}$`);
  const monthlySheets = allSheets
    .map(s => s.properties.title)
    .filter(t => monthlyPattern.test(t))
    .sort((a, b) => {
      const [mA, yA] = a.split(' ');
      const [mB, yB] = b.split(' ');
      return parseInt(yA) - parseInt(yB) || MESES.indexOf(mA) - MESES.indexOf(mB);
    });

  const monthlyData = [];
  for (const name of monthlySheets) {
    const rows = await readRows(sheets, spreadsheetId, name);
    let ing = 0, gas = 0;
    for (const [, tipo, , montoStr] of rows) {
      if (!tipo || !montoStr) continue;
      const m = parseFloat(montoStr);
      if (isNaN(m)) continue;
      if (tipo === 'Ingreso') ing += m;
      else if (tipo === 'Gasto') gas += m;
    }
    monthlyData.push([name, ing, gas, ing - gas]);
  }

  const currentMonth = getMonthlySheetName();
  const currentRows = await readRows(sheets, spreadsheetId, currentMonth);
  const catMap = new Map();
  for (const [, tipo, , montoStr, categoria] of currentRows) {
    if (tipo !== 'Gasto' || !montoStr || !categoria) continue;
    const m = parseFloat(montoStr);
    if (!isNaN(m)) catMap.set(categoria, (catMap.get(categoria) || 0) + m);
  }
  const catData = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
  const totalGastos = catData.reduce((s, [, v]) => s + v, 0);

  const statsSheetId = await ensureSheet(sheets, spreadsheetId, SHEET_ESTADISTICAS, false);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_ESTADISTICAS}'!A1:Z200`,
  });

  // Eliminar gráficos existentes (usar meta fresca)
  const freshMeta = await getMeta(sheets, spreadsheetId);
  const statsSheetMeta = freshMeta.sheets.find(s => s.properties.title === SHEET_ESTADISTICAS);
  const existingCharts = statsSheetMeta?.charts || [];
  if (existingCharts.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: existingCharts.map(c => ({ deleteEmbeddedObject: { objectId: c.chartId } })),
      },
    });
  }

  // ── Escribir valores ──
  // Tabla mensual: fila 0=título, fila 1=headers, filas 2+= datos
  if (monthlyData.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_ESTADISTICAS}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['RESUMEN POR MES', '', '', ''],
          ['Mes', 'Ingresos', 'Gastos', 'Balance'],
          ...monthlyData,
        ],
      },
    });
  }

  // Tabla categorías: fila 0=título, fila 1=headers, filas 2+= datos, última=total
  if (catData.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_ESTADISTICAS}'!F1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [`GASTOS POR CATEGORÍA — ${currentMonth}`, '', ''],
          ['Categoría', 'Total', '%'],
          ...catData.map(([cat, total]) => [cat, total, totalGastos > 0 ? total / totalGastos : 0]),
          ['TOTAL', totalGastos, 1],
        ],
      },
    });
  }

  // ── Formato ──
  const fmt = [];
  const cell = (startRow, endRow, startCol, endCol, format) => fmt.push({
    repeatCell: {
      range: { sheetId: statsSheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: { userEnteredFormat: format },
      fields: `userEnteredFormat(${Object.keys(format).join(',')})`,
    },
  });

  // Título tabla mensual
  cell(0, 1, 0, 4, {
    backgroundColor: { red: 0.24, green: 0.52, blue: 0.78 },
    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 },
    verticalAlignment: 'MIDDLE',
  });
  // Header tabla mensual
  cell(1, 2, 0, 4, {
    backgroundColor: { red: 0.80, green: 0.88, blue: 0.97 },
    textFormat: { bold: true, foregroundColor: { red: 0.15, green: 0.15, blue: 0.15 } },
    horizontalAlignment: 'CENTER',
  });
  // Formato moneda columnas B-D (datos mensuales)
  if (monthlyData.length > 0) {
    cell(2, 2 + monthlyData.length, 1, 4, {
      numberFormat: { type: 'NUMBER', pattern: '#,##0' },
    });
  }

  // Título tabla categorías
  cell(0, 1, 5, 8, {
    backgroundColor: { red: 0.18, green: 0.62, blue: 0.42 },
    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 },
    verticalAlignment: 'MIDDLE',
  });
  // Header tabla categorías
  cell(1, 2, 5, 8, {
    backgroundColor: { red: 0.80, green: 0.93, blue: 0.83 },
    textFormat: { bold: true, foregroundColor: { red: 0.15, green: 0.15, blue: 0.15 } },
    horizontalAlignment: 'CENTER',
  });

  if (catData.length > 0) {
    // Color por categoría
    catData.forEach(([cat], i) => {
      const color = CAT_COLORS[cat] || { red: 0.95, green: 0.95, blue: 0.95 };
      cell(2 + i, 3 + i, 5, 8, { backgroundColor: color });
    });
    // Fila TOTAL
    const totalRow = 2 + catData.length;
    cell(totalRow, totalRow + 1, 5, 8, {
      backgroundColor: { red: 0.22, green: 0.22, blue: 0.22 },
      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
    });
    // Formato moneda columna G y % columna H
    cell(2, totalRow + 1, 6, 7, { numberFormat: { type: 'NUMBER', pattern: '#,##0' } });
    cell(2, totalRow + 1, 7, 8, { numberFormat: { type: 'PERCENT', pattern: '0.0%' } });
  }

  // Filas alternadas en tabla mensual
  if (monthlyData.length > 0) {
    monthlyData.forEach((_, i) => {
      if (i % 2 === 1) {
        cell(2 + i, 3 + i, 0, 3, {
          backgroundColor: { red: 0.96, green: 0.97, blue: 1.00 },
        });
      }
    });
  }

  // Balance: verde si positivo, rojo si negativo (va después de alternadas para no pisarse)
  if (monthlyData.length > 0) {
    monthlyData.forEach(([, , , balance], i) => {
      cell(2 + i, 3 + i, 3, 4, {
        backgroundColor: balance >= 0
          ? { red: 0.78, green: 0.94, blue: 0.78 }
          : { red: 0.97, green: 0.78, blue: 0.78 },
        textFormat: { bold: true },
      });
    });
  }

  // Bold en nombres de categoría
  if (catData.length > 0) {
    catData.forEach((_, i) => {
      fmt.push({
        repeatCell: {
          range: { sheetId: statsSheetId, startRowIndex: 2 + i, endRowIndex: 3 + i, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      });
    });
  }

  // Borde exterior + interiores tabla mensual
  const borderSolid = { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7, alpha: 1 } };
  const borderOuter = { style: 'SOLID_MEDIUM', width: 2, color: { red: 0.5, green: 0.5, blue: 0.5, alpha: 1 } };
  if (monthlyData.length > 0) {
    fmt.push({
      updateBorders: {
        range: { sheetId: statsSheetId, startRowIndex: 1, endRowIndex: 2 + monthlyData.length, startColumnIndex: 0, endColumnIndex: 4 },
        top: borderOuter, bottom: borderOuter, left: borderOuter, right: borderOuter,
        innerHorizontal: borderSolid, innerVertical: borderSolid,
      },
    });
  }
  // Borde exterior + interiores tabla categorías
  if (catData.length > 0) {
    fmt.push({
      updateBorders: {
        range: { sheetId: statsSheetId, startRowIndex: 1, endRowIndex: 3 + catData.length, startColumnIndex: 5, endColumnIndex: 8 },
        top: borderOuter, bottom: borderOuter, left: borderOuter, right: borderOuter,
        innerHorizontal: borderSolid, innerVertical: borderSolid,
      },
    });
  }

  // Altura fila de títulos
  fmt.push({
    updateDimensionProperties: {
      range: { sheetId: statsSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 36 },
      fields: 'pixelSize',
    },
  });
  // Anchos de columna: A=130 B=105 C=105 D=105 E=20 F=145 G=105 H=65
  [130, 105, 105, 105, 20, 145, 105, 65].forEach((px, i) => {
    fmt.push({
      updateDimensionProperties: {
        range: { sheetId: statsSheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: fmt } });

  // ── Gráficos ──
  const chartRequests = [];

  if (monthlyData.length > 0) {
    const rows = monthlyData.length + 2; // +2 por título y header
    chartRequests.push({
      addChart: {
        chart: {
          spec: {
            title: 'Ingresos vs Gastos por Mes',
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'BOTTOM_LEGEND',
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Mes' },
                { position: 'LEFT_AXIS', title: '$' },
              ],
              domains: [{
                domain: {
                  sourceRange: { sources: [{ sheetId: statsSheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: 1 }] },
                },
              }],
              series: [
                { series: { sourceRange: { sources: [{ sheetId: statsSheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 1, endColumnIndex: 2 }] } }, targetAxis: 'LEFT_AXIS' },
                { series: { sourceRange: { sources: [{ sheetId: statsSheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 2, endColumnIndex: 3 }] } }, targetAxis: 'LEFT_AXIS' },
              ],
              headerCount: 1,
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: statsSheetId, rowIndex: 0, columnIndex: 9 },
              widthPixels: 580,
              heightPixels: 340,
            },
          },
        },
      },
    });
  }

  if (catData.length > 0) {
    const rows = catData.length + 2;
    chartRequests.push({
      addChart: {
        chart: {
          spec: {
            title: `Gastos por Categoría — ${currentMonth}`,
            pieChart: {
              legendPosition: 'RIGHT_LEGEND',
              threeDimensional: false,
              domain: {
                sourceRange: { sources: [{ sheetId: statsSheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 5, endColumnIndex: 6 }] },
              },
              series: {
                sourceRange: { sources: [{ sheetId: statsSheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 6, endColumnIndex: 7 }] },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: statsSheetId, rowIndex: 20, columnIndex: 9 },
              widthPixels: 500,
              heightPixels: 340,
            },
          },
        },
      },
    });
  }

  if (chartRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: chartRequests } });
  }

  console.log('[Sheets] Estadísticas actualizadas.');
}

module.exports = { appendRow, getMonthlySummary, updateEstadisticas };
