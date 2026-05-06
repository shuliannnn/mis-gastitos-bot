'use strict';

const Groq = (() => { try { return require('groq-sdk'); } catch { return null; } })();

const CATEGORIES = [
  'Comida', 'Supermercado', 'Farmacia', 'Costo Fijo', 'Auto',
  'Ocio', 'Deporte', 'Hogar', 'Servicios', 'Salud',
  'Educación', 'Salidas', 'Compras', 'Suscripciones', 'Otros',
];

let groqClient = null;

async function categorizeWithAI(descripcion, tipo) {
  if (!Groq || !process.env.GROQ_API_KEY) return null;
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
    const res = await groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 15,
      messages: [{
        role: 'user',
        content:
          `Tipo: ${tipo}. Descripción: "${descripcion}".\n` +
          `Categorías posibles: ${CATEGORIES.join(', ')}.\n` +
          `Respondé SOLO con el nombre exacto de la categoría.`,
      }],
    });
    const result = res.choices[0]?.message?.content?.trim();
    return CATEGORIES.includes(result) ? result : null;
  } catch (err) {
    console.error('[Categorizer] Groq error:', err.message);
    return null;
  }
}

const RULES = [
  { cat: 'Supermercado',   words: ['super', 'supermercado', 'coto', 'carrefour', 'disco', 'jumbo', 'dia', 'vea', 'mercado', 'almacen', 'verduleria', 'panaderia', 'kiosco'] },
  { cat: 'Comida',         words: ['delivery', 'pedidosya', 'rappi', 'mcdonald', 'pizza', 'sushi', 'burger', 'comida', 'empanadas', 'medialunas', 'taco'] },
  { cat: 'Salidas',        words: ['bar', 'restaurant', 'restaurante', 'cafe', 'cafeteria', 'cerveza', 'birra', 'vino', 'fernet', 'tragos', 'copas', 'almuerzo', 'cena', 'desayuno'] },
  { cat: 'Auto',           words: ['nafta', 'gasoil', 'combustible', 'estacionamiento', 'peaje', 'autopista', 'patente', 'mecanico', 'taller', 'seguro auto', 'gnc', 'neumatico', 'aceite'] },
  { cat: 'Farmacia',       words: ['farmacia', 'medicamento', 'medicina', 'remedio', 'cepillo', 'pasta dental', 'vitamina', 'suplemento', 'ibuprofeno', 'paracetamol'] },
  { cat: 'Salud',          words: ['doctor', 'medico', 'consulta', 'clinica', 'hospital', 'dentista', 'odontologo', 'lentes', 'analisis', 'laboratorio', 'prepaga', 'obra social', 'osde'] },
  { cat: 'Costo Fijo',     words: ['alquiler', 'expensas', 'hipoteca', 'cuota', 'prestamo', 'seguro'] },
  { cat: 'Servicios',      words: ['luz', 'gas', 'agua', 'internet', 'wifi', 'telefono', 'cable', 'edesur', 'edenor', 'metrogas', 'aysa', 'fibertel', 'telecentro', 'claro', 'movistar', 'plomero', 'electricista'] },
  { cat: 'Suscripciones',  words: ['netflix', 'spotify', 'disney', 'amazon', 'youtube', 'icloud', 'suscripcion', 'membresia', 'abono', 'steam', 'adobe'] },
  { cat: 'Hogar',          words: ['mueble', 'electrodomestico', 'heladera', 'lavarropas', 'lampara', 'colchon', 'ikea', 'easy', 'sodimac', 'ferreteria', 'pintura', 'cortina'] },
  { cat: 'Compras',        words: ['ropa', 'zapatillas', 'zapatos', 'camisa', 'remera', 'celular', 'notebook', 'auriculares', 'zara', 'adidas', 'nike', 'mercadolibre', 'amazon'] },
  { cat: 'Ocio',           words: ['cine', 'teatro', 'recital', 'show', 'entrada', 'videojuego', 'playstation', 'xbox', 'boliche', 'after', 'fiesta'] },
  { cat: 'Deporte',        words: ['gimnasio', 'gym', 'crossfit', 'pilates', 'yoga', 'cancha', 'running', 'natacion', 'pileta'] },
  { cat: 'Educación',      words: ['curso', 'facultad', 'universidad', 'colegio', 'libro', 'clase', 'profesor', 'udemy', 'platzi', 'maestria'] },
];

function categorizeLocal(descripcion) {
  const text = descripcion.toLowerCase();
  for (const { cat, words } of RULES) {
    if (words.some(w => text.includes(w))) return cat;
  }
  return null;
}

async function categorize(descripcion, tipo = 'Gasto') {
  // 1. Groq primero si hay key
  const ai = await categorizeWithAI(descripcion, tipo);
  if (ai) return ai;

  // 2. Fallback a palabras clave
  return categorizeLocal(descripcion) || 'Otros';
}

module.exports = { categorize };
