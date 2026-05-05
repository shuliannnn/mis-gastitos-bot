'use strict';

/**
 * Parsea un mensaje de texto en un objeto de transacción.
 * Formato esperado: "<tipo> <monto> <categoría> [descripción...]"
 * Ejemplo: "gasto 1500 super mercado chino"
 *
 * @param {string} text
 * @returns {{ tipo: string, monto: number, categoria: string, descripcion: string } | null}
 */
function parseMessage(text) {
  const normalized = text.trim().toLowerCase();
  const parts = normalized.split(/\s+/);

  if (parts.length < 3) return null;

  const [tipoRaw, montoRaw, categoriaRaw, ...resto] = parts;

  if (tipoRaw !== 'gasto' && tipoRaw !== 'ingreso') return null;

  const monto = parseFloat(montoRaw.replace(',', '.'));
  if (isNaN(monto) || monto <= 0) return null;

  const tipo = tipoRaw.charAt(0).toUpperCase() + tipoRaw.slice(1);
  const categoria = categoriaRaw.charAt(0).toUpperCase() + categoriaRaw.slice(1);
  const descripcion = resto.join(' ');

  return { tipo, monto, categoria, descripcion };
}

function helpMessage() {
  return (
    '❓ No entendí el mensaje. Usá este formato:\n\n' +
    '*gasto <monto> <categoría> [descripción]*\n' +
    '*ingreso <monto> <categoría> [descripción]*\n\n' +
    'Ejemplos:\n' +
    '• `gasto 1500 super`\n' +
    '• `gasto 500 farmacia medicamentos`\n' +
    '• `ingreso 80000 sueldo diciembre`\n' +
    '• `ingreso 5000 freelance proyecto web`\n\n' +
    'También podés escribir *resumen* para ver los totales del mes.'
  );
}

module.exports = { parseMessage, helpMessage };
