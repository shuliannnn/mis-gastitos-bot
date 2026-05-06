'use strict';

/**
 * Formato: "<tipo> <descripción> <monto> [método de pago]"
 * El monto (número) actúa como separador entre descripción y método.
 *
 * Ejemplos:
 *   "gasto boliche 120000 transferencia"
 *   "gasto bar lo de tito 42000"
 *   "gasto cepillo de dientes 2500 efectivo"
 *   "ingreso sueldo enero 150000"
 */
function parseMessage(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3) return null;

  const tipo = parts[0].toLowerCase();
  if (tipo !== 'gasto' && tipo !== 'ingreso') return null;

  const rest = parts.slice(1);
  const montoIdx = rest.findIndex(p => {
    const n = parseFloat(p.replace(',', '.'));
    return !isNaN(n) && n > 0;
  });

  if (montoIdx < 1) return null; // necesita al menos una palabra antes del monto

  const monto = parseFloat(rest[montoIdx].replace(',', '.'));
  const descripcion = rest.slice(0, montoIdx).join(' ');
  const metodoPago = rest.slice(montoIdx + 1).join(' ');

  return {
    tipo: tipo.charAt(0).toUpperCase() + tipo.slice(1),
    monto,
    descripcion,
    categoria: '',
    metodoPago,
  };
}

function helpMessage() {
  return (
    '❓ Formato:\n\n' +
    '*gasto <descripción> <monto> [método de pago]*\n' +
    '*ingreso <descripción> <monto> [método de pago]*\n\n' +
    'Ejemplos:\n' +
    '• `gasto boliche 120000 transferencia`\n' +
    '• `gasto bar lo de tito 42000`\n' +
    '• `gasto cepillo de dientes 2500 efectivo`\n' +
    '• `ingreso sueldo enero 150000`\n\n' +
    'Escribí *resumen* para ver los totales del mes.'
  );
}

module.exports = { parseMessage, helpMessage };
