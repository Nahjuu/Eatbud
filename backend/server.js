import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';

dotenv.config();

const requiredVariables = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GROQ_API_KEY'];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

if (missingVariables.length) {
  throw new Error(`Faltan variables de entorno: ${missingVariables.join(', ')}`);
}

const app = express();
const port = Number(process.env.PORT) || 3000;
// openai/gpt-oss-120b admite búsqueda en la web integrada (necesaria para
// confirmar las calorías reales de cada alimento). Se puede sobrescribir con
// GROQ_MODEL. Se conserva la exclusión de 'groq/compound-mini' por retrocompatibilidad.
const model = process.env.GROQ_MODEL && process.env.GROQ_MODEL !== 'groq/compound-mini'
  ? process.env.GROQ_MODEL
  : 'openai/gpt-oss-120b';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// Respaldo opcional: DeepSeek (API compatible con OpenAI). Se usa sólo cuando
// Groq falla (límite de tokens, caídas o errores de validación). Si
// DEEPSEEK_API_KEY queda vacío, el respaldo queda desactivado.
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
// Modelo con visión de Groq. Sólo se usa cuando la comida se envía con una foto:
// el modelo de texto por defecto no acepta imágenes. Se puede sobrescribir con
// GROQ_VISION_MODEL.
const visionModel = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';

// Tipos de imagen aceptados (los mismos que admite el proveedor de visión).
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// El navegador reduce la foto antes de enviarla, así que este límite es holgado.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
// Texto que se guarda cuando la comida es sólo una foto (la columna food_text es
// obligatoria); es una etiqueta de interfaz, no un dato nutricional.
const PHOTO_ONLY_LABEL = '📷 Foto de comida';
// Texto que acompaña a la imagen cuando el usuario no escribió nada.
const PHOTO_ONLY_INSTRUCTION = 'Estima la comida que se ve en la foto.';

// ---------------------------------------------------------------------------
// Zona horaria de referencia — todas las fechas locales se calculan en UY
// ---------------------------------------------------------------------------
const TZ = 'America/Montevideo';

/**
 * Devuelve la fecha local (YYYY-MM-DD) en la zona horaria de Uruguay
 * para un instante dado (por defecto, ahora).
 */
function localDateInTZ(instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);

    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const dPart = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${dPart}`;
  } catch {
    // Fallback: algunos runtimes serverless (Vercel) no incluyen los datos
    // completos de zona horaria (ICU). Uruguay es UTC-3 todo el año.
    return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

/**
 * Dado un string YYYY-MM-DD, devuelve los instantes ISO que delimitan
 * ese día en la zona horaria de Uruguay (America/Montevideo).
 *
 * Ejemplo: '2026-10-15' → { start: '2026-10-15T03:00:00.000Z', end: '2026-10-16T03:00:00.000Z' }
 * (en UTC-3)
 */
function dateRangeForLocalDay(dateStr) {
  const value = dateStr || localDateInTZ();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('La fecha debe tener formato YYYY-MM-DD');
  }

  const [y, m, d] = value.split('-').map(Number);
  let offsetMs = -3 * 3600000;

  try {
    const approx = Date.UTC(y, m - 1, d, 12, 0, 0);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date(approx));
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-03:00';
    const match = tzName.match(/GMT([+-])(\d{2}):(\d{2})/);
    const sign = match ? (match[1] === '+' ? 1 : -1) : -1;
    offsetMs = match
      ? sign * (parseInt(match[2], 10) * 3600000 + parseInt(match[3], 10) * 60000)
      : -3 * 3600000;
  } catch {
    // Fallback: si el runtime no expone los datos de zona horaria, asumimos
    // el offset fijo de Uruguay (UTC-3, sin horario de verano).
    offsetMs = -3 * 3600000;
  }

  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;

  return {
    value,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

/**
 * Dado un rango de fechas locales (YYYY-MM-DD), devuelve start/end ISO.
 */
function weekRangeForLocalDates(startDate, endDate) {
  const rangeStart = dateRangeForLocalDay(startDate);
  const rangeEnd = dateRangeForLocalDay(endDate);
  return { start: rangeStart.start, end: rangeEnd.end };
}

/**
 * Dado un string YYYY-MM-DD, devuelve el lunes de esa semana.
 */
function getMonday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay(); // 0=dom, 1=lun, ..., 6=sab
  const diff = day === 0 ? 6 : day - 1; // Cuántos días restar para llegar al lunes
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Devuelve la fecha local del día anterior en horario de Uruguay.
 */
function getYesterdayInTZ(instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const yesterdayInstant = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return localDateInTZ(yesterdayInstant);
}

/**
 * Calcula los milisegundos exactos hasta las 00:00:00 en horario uruguayo (America/Montevideo, UTC-3).
 */
function msUntilNextMidnightUY(now = new Date()) {
  const todayStr = localDateInTZ(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const [ty, tm, td] = tomorrowStr.split('-').map(Number);
  // Las 00:00:00 en Uruguay (UTC-3) corresponden exactamente a las 03:00:00 UTC
  const midnightUtcMs = Date.UTC(ty, tm - 1, td, 3, 0, 0);
  return Math.max(1000, midnightUtcMs - now.getTime());
}

async function getUserFromReq(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const token = authHeader.split(' ')[1];

  if (process.env.NODE_ENV === 'test' && token.startsWith('test-user-')) {
    return token;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error('Unauthorized');
  }
  return user.id;
}

// Orígenes permitidos por defecto (desarrollo local + frontend de producción).
// FRONTEND_URL puede añadir más URLs separadas por comas (por ejemplo, los
// previews de Vercel), sin necesidad de tocar el código.
const defaultOrigins = ['http://localhost:5173', 'https://eatbud.vercel.app'];
const allowedOrigins = [
  ...defaultOrigins,
  ...(process.env.FRONTEND_URL || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
];

app.use(cors({
  origin: (origin, callback) => {
    // Sin Origin (curl, server-to-server, mismo origen) siempre se permite.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));
// Límite amplio porque el registro de comidas puede incluir una foto en base64
// (el navegador la reduce antes de enviarla, así que el cuerpo real es pequeño).
app.use(express.json({ limit: '8mb' }));

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : 0;
}

function databaseMessage(error) {
  if (error.message.includes('parsed_data')) {
    return 'La base de datos usa un esquema antiguo. Ejecuta backend/schema.sql en Supabase y vuelve a intentarlo.';
  }

  return 'No se pudo consultar la base de datos.';
}

function parseAnalysis(content) {
  // El browser search de Groq devuelve citas tipo 【2†L6-L10】 y, a veces,
  // rodea el JSON con vallas de markdown. Las quitamos antes de parsear.
  const cleaned = String(content || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[\d+†[^\]]*\]/g, '');

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
  }

  const response = JSON.parse(cleaned.slice(start, end + 1));
  const foods = Array.isArray(response.foods) ? response.foods : [];

  if (!foods.length) {
    throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
  }

  const normalizedFoods = foods.map((food) => ({
    name: String(food.name || 'Alimento'),
    quantity: number(food.quantity),
    unit: String(food.unit || 'porción'),
    calories: number(food.calories),
    protein: number(food.protein),
    carbs: number(food.carbs),
    fat: number(food.fat),
  }));

  const totals = normalizedFoods.reduce(
    (sum, food) => ({
      calories: sum.calories + food.calories,
      protein: sum.protein + food.protein,
      carbs: sum.carbs + food.carbs,
      fat: sum.fat + food.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return { foods: normalizedFoods, totals };
}

// ---------------------------------------------------------------------------
// Validación de la foto adjunta (opcional)
// ---------------------------------------------------------------------------

/**
 * Valida y normaliza la imagen opcional que llega junto a la comida.
 * Acepta únicamente un data URL base64 de JPEG, PNG o WebP dentro del límite de
 * tamaño. Devuelve `null` si no se envió imagen y lanza un error descriptivo si
 * el valor recibido no es utilizable.
 */
function parseImagePayload(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string') {
    throw new Error('La imagen enviada no es válida.');
  }

  const match = IMAGE_DATA_URL_PATTERN.exec(value.trim());

  if (!match) {
    throw new Error('Formato de imagen no admitido. Usá una foto JPEG, PNG o WebP.');
  }

  const [, mimeType, base64] = match;

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new Error('Formato de imagen no admitido. Usá una foto JPEG, PNG o WebP.');
  }

  const bytes = Math.floor((base64.length * 3) / 4);

  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error('La imagen es demasiado grande. Probá con una foto más liviana.');
  }

  if (bytes < 128) {
    throw new Error('La imagen está dañada o vacía. Probá con otra foto.');
  }

  return {
    mimeType,
    bytes,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

// ---------------------------------------------------------------------------
// Obtener resumen de un día (reutilizado por múltiples endpoints)
// ---------------------------------------------------------------------------
async function getDailySummary(userId, date) {
  const range = dateRangeForLocalDay(date);
  const { data, error } = await supabase
    .from('daily_logs')
    .select('id, food_text, parsed_data, logged_at')
    .eq('user_id', userId)
    .gte('logged_at', range.start)
    .lt('logged_at', range.end)
    .order('logged_at', { ascending: false });

  if (error) throw error;

  const entries = (data || []).map((log) => {
    const analysis = log.parsed_data || {};

    return {
      id: log.id,
      foodText: log.food_text,
      loggedAt: log.logged_at,
      foods: Array.isArray(analysis.foods) ? analysis.foods : [],
      totals: analysis.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 },
    };
  });

  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + number(entry.totals.calories),
      protein: sum.protein + number(entry.totals.protein),
      carbs: sum.carbs + number(entry.totals.carbs),
      fat: sum.fat + number(entry.totals.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return { date: range.value, totals, entries };
}

/**
 * Cierre diario e idempotente para un usuario y una fecha dada.
 * Calcula los totales a partir de `daily_logs` persistidos y
 * registra/actualiza el resumen en `daily_summaries`.
 * Si se ejecuta varias veces para la misma fecha, actualiza el registro existente
 * sin duplicar filas.
 */
async function closeDailySummary(userId, dateStr) {
  const date = dateStr || localDateInTZ();
  const summary = await getDailySummary(userId, date);
  const { totals, entries } = summary;
  const mealCount = entries.length;

  try {
    // Si no hay comidas para este día, eliminamos cualquier resumen existente huérfano
    if (mealCount === 0) {
      await supabase
        .from('daily_summaries')
        .delete()
        .eq('user_id', userId)
        .eq('date', date);
      return { date, totals, mealCount, closedAt: null };
    }

    // Buscamos si ya existe el resumen para este día
    const { data: existingRows } = await supabase
      .from('daily_summaries')
      .select('id')
      .eq('user_id', userId)
      .eq('date', date);

    const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;

    // Si existieran filas duplicadas de ejecuciones anteriores, eliminamos las extras
    if (existingRows && existingRows.length > 1) {
      const extraIds = existingRows.slice(1).map((r) => r.id);
      await supabase.from('daily_summaries').delete().in('id', extraIds);
    }

    const nowIso = new Date().toISOString();
    const conclusionJson = JSON.stringify({
      totals,
      mealCount,
      summaryText: `Resumen del día ${date}: ${totals.calories} kcal, ${totals.protein}g P, ${totals.carbs}g C, ${totals.fat}g G across ${mealCount} comida(s).`,
    });

    const fullPayload = {
      user_id: userId,
      date,
      total_calories: totals.calories,
      total_protein: totals.protein,
      total_carbs: totals.carbs,
      total_fat: totals.fat,
      meal_count: mealCount,
      conclusion_text: conclusionJson,
      closed_at: nowIso,
      updated_at: nowIso,
    };

    if (existing) {
      // Intentamos actualizar con todas las columnas
      const { error: updateErr } = await supabase
        .from('daily_summaries')
        .update(fullPayload)
        .eq('id', existing.id);

      if (updateErr) {
        // Fallback por si la tabla aún tiene el esquema legacy sin columnas numéricas
        await supabase
          .from('daily_summaries')
          .update({ conclusion_text: conclusionJson })
          .eq('id', existing.id);
      }
    } else {
      const { error: insertErr } = await supabase
        .from('daily_summaries')
        .insert(fullPayload);

      if (insertErr) {
        // Fallback por si la tabla aún tiene el esquema legacy
        await supabase
          .from('daily_summaries')
          .insert({
            user_id: userId,
            date,
            conclusion_text: conclusionJson,
          });
      }
    }

    return { date, totals, mealCount, closedAt: nowIso };
  } catch (err) {
    console.error(`Error closing daily summary for user ${userId} on ${date}:`, err.message);
    return { date, totals, mealCount, error: err.message };
  }
}

/**
 * Reconcilia días pasados para asegurar que si la aplicación estuvo cerrada
 * durante el cambio de día, los resúmenes anteriores queden generados
 * y cerrados correctamente de forma idempotente.
 */
async function reconcilePastDays(userId) {
  try {
    const today = localDateInTZ();
    const { data: pastLogs } = await supabase
      .from('daily_logs')
      .select('logged_at')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(100);

    if (!pastLogs || pastLogs.length === 0) return;

    const pastDates = new Set();
    for (const log of pastLogs) {
      const day = localDateInTZ(new Date(log.logged_at));
      if (day < today) {
        pastDates.add(day);
      }
    }

    for (const pastDate of pastDates) {
      await closeDailySummary(userId, pastDate);
    }
  } catch (err) {
    console.error('Error reconciling past days:', err.message);
  }
}

/**
 * Prompt del analizador nutricional. El modelo NO tiene búsqueda web: estima
 * siempre con su conocimiento nutricional de referencia (valores USDA por 100 g
 * y tablas estándar de composición de alimentos).
 */
const FOOD_ANALYSIS_SYSTEM_PROMPT = `Eres un nutricionista experto. Analiza el texto que describe una o varias comidas y devuelve el desglose nutricional de CADA alimento por separado.

Reglas:
1. Respeta EXACTAMENTE la cantidad indicada (gramos, ml, tazas, cucharadas, unidades o porciones). Si no se indica cantidad, asume una porción estándar.
2. Convierte medidas caseras (taza, cucharada, cucharadita, plato, porción, unidad mediana, etc.) a su equivalente en gramos usando pesos de referencia estándar (1 huevo ≈ 50 g, 1 taza de arroz cocido ≈ 158 g, 1 cucharada de aceite ≈ 14 g, 1 rebanada de pan ≈ 30 g, etc.).
3. Los valores de calories, protein, carbs y fat deben ser para la CANTIDAD TOTAL indicada, NO por cada 100 g.
4. No tienes acceso a internet ni a búsqueda web: estima cada alimento con tu conocimiento nutricional de referencia (valores USDA por 100 g y tablas estándar de composición de alimentos) y multiplícalos por la cantidad indicada.
5. Para comidas preparadas, de restaurante, platos regionales o productos de marca, haz tu mejor estimación a partir de sus ingredientes y técnicas de cocción típicas, con porciones realistas y prudentes.
6. "protein", "carbs" y "fat" van en GRAMOS (nunca en porcentaje).
7. Coherencia macro-calórica: 1 g de proteína ≈ 4 kcal, 1 g de carbohidrato ≈ 4 kcal, 1 g de grasa ≈ 9 kcal. La suma aproximada debe coincidir con las calorías.
8. Devuelve SIEMPRE el JSON como texto plano de la respuesta, NUNCA como llamada a una herramienta o función (no inventes herramientas). Responde directo y conciso: sin explicaciones, sin narraciones, sin markdown y sin citas. Devuelve ÚNICAMENTE JSON válido con esta estructura exacta:
{"foods":[{"name":"","quantity":0,"unit":"","calories":0,"protein":0,"carbs":0,"fat":0}]}`;

/**
 * Instrucciones extra que se añaden al prompt sólo cuando la comida se envía con
 * una foto. El texto y la imagen describen la MISMA comida: se interpretan
 * juntos y producen un único desglose nutricional.
 */
const FOOD_PHOTO_ANALYSIS_ADDENDUM = `

Además del texto, recibes UNA FOTO de la comida. El texto y la foto describen la MISMA comida y debes interpretarlos juntos para producir UN ÚNICO desglose nutricional:
- Usa el texto como contexto principal para identificar los alimentos, sus ingredientes y las cantidades (por ejemplo "es un sándwich de pollo con un poco de mayonesa").
- Usa la foto como evidencia visual para confirmar o corregir qué alimentos hay, sus ingredientes visibles y el tamaño de la porción.
- NUNCA analices el texto y la foto como comidas separadas, ni devuelvas dos resultados distintos.
- NUNCA cuentes dos veces un alimento: si aparece en el texto y también se ve en la foto, es el mismo alimento y va en UNA sola línea del JSON.
- Si el texto menciona un alimento que no se ve en la foto, respétalo e inclúyelo.
- Si la foto muestra un alimento que el texto no menciona, inclúyelo también.
- Si el texto está vacío, estima la comida usando únicamente la foto.
- Si la foto no muestra comida o no se puede interpretar, analiza sólo lo que indique el texto.`;

/**
 * Analiza la comida del usuario. `foodText` puede ir vacío si el usuario adjuntó
 * una foto, y `image` puede ser null si sólo escribió texto. Usa Groq como motor
 * principal (con un modelo con visión cuando hay foto) y, sólo para texto, cae al
 * respaldo de DeepSeek. Ninguno de los dos usa búsqueda web.
 */
async function analyzeFood(foodText, image = null) {
  try {
    return await analyzeWithGroq(foodText, image);
  } catch (groqErr) {
    console.error('Groq no pudo analizar el alimento:', groqErr.message);

    // El respaldo de DeepSeek no acepta imágenes: si había foto no lo usamos, en
    // vez de descartar la foto en silencio o mandarla a un modelo sin visión.
    if (!image && DEEPSEEK_API_KEY) {
      try {
        return await analyzeWithDeepSeek(foodText);
      } catch (deepseekErr) {
        console.error('DeepSeek tampoco pudo analizar el alimento:', deepseekErr.message);
      }
    }

    throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
  }
}

async function analyzeWithGroq(foodText, image = null) {
  // Con foto cambiamos al modelo con visión y enviamos texto e imagen en UN
  // único mensaje de usuario para que el modelo los interprete juntos.
  const activeModel = image ? visionModel : model;
  const systemPrompt = image
    ? FOOD_ANALYSIS_SYSTEM_PROMPT + FOOD_PHOTO_ANALYSIS_ADDENDUM
    : FOOD_ANALYSIS_SYSTEM_PROMPT;
  const userContent = image
    ? [
        { type: 'text', text: foodText || PHOTO_ONLY_INSTRUCTION },
        { type: 'image_url', image_url: { url: image.dataUrl } },
      ]
    : foodText;

  try {
    const completion = await groq.chat.completions.create({
      model: activeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      // Sin búsqueda web: el análisis es puramente estimativo, así que forzamos
      // la salida JSON y pedimos el mínimo razonamiento posible. Los modelos
      // gpt-oss gastan tokens "pensando" antes de responder; 'low' recorta ese
      // gasto sin afectar la estimación nutricional.
      response_format: { type: 'json_object' },
      ...(/gpt-oss/i.test(activeModel) ? { reasoning_effort: 'low' } : {}),
    });
    return parseAnalysis(completion.choices[0]?.message?.content || '');
  } catch (err) {
    // Los modelos gpt-oss a veces devuelven el JSON como si fuese una llamada a
    // herramienta ("tool_use_failed"). Groq rechaza la respuesta, pero incluye el
    // JSON generado dentro del error: lo rescatamos para no perder el análisis.
    const salvaged = salvageToolUseFailure(err);
    if (salvaged) return parseAnalysis(salvaged);
    throw err;
  }
}

// Respaldo con DeepSeek (API compatible con OpenAI, sin búsqueda web).
async function analyzeWithDeepSeek(foodText) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: FOOD_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: foodText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      // Acotamos la salida para que el respaldo sea lo más económico posible.
      max_tokens: 1024,
      stream: false,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  return parseAnalysis(data?.choices?.[0]?.message?.content || '');
}

// Recupera el JSON que el modelo generó cuando Groq lo rechaza por haberlo
// enviado como una llamada a una herramienta inexistente.
function salvageToolUseFailure(err) {
  const body = err?.error ?? err?.response?.data ?? err;
  const failed = body?.failed_generation;
  if (!failed || typeof failed !== 'string') return null;
  try {
    const parsed = JSON.parse(failed);
    const args = parsed && parsed.arguments !== undefined ? parsed.arguments : parsed;
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    if (obj && Array.isArray(obj.foods) && obj.foods.length > 0) return JSON.stringify(obj);
  } catch {
    /* la generación fallida no es un JSON rescatable */
  }
  return null;
}

// ---------------------------------------------------------------------------
// ENDPOINTS
// ---------------------------------------------------------------------------

app.get('/api/health', async (_req, res) => {
  const { error } = await supabase.from('daily_logs').select('id, parsed_data').limit(1);

  if (error) {
    console.error('Supabase health check failed:', error.message);
    return res.status(503).json({ ok: false, database: false, error: databaseMessage(error) });
  }

  return res.json({ ok: true, database: true, model });
});

// Cierre diario manual o programado (idempotente)
app.post('/api/daily-summary/close', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const date = req.body.date || localDateInTZ();
    const result = await closeDailySummary(userId, date);
    return res.json({ ok: true, summary: result });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not close daily summary:', error.message);
    return res.status(500).json({ error: 'No se pudo realizar el cierre diario.' });
  }
});

// Resumen del día actual (o de una fecha específica)
app.get('/api/daily-summary', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const summary = await getDailySummary(userId, req.query.date);

    // Si se consulta el día actual sin fecha explícita, reconciliamos días pasados en segundo plano
    if (!req.query.date) {
      reconcilePastDays(userId).catch(() => {});
    }

    return res.json(summary);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not get daily summary:', error.message);
    return res.status(500).json({ error: databaseMessage(error) });
  }
});

// Registrar una comida (texto, foto o ambos)
app.post('/api/logs', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const foodText = String(req.body.foodText || '').trim();

    // La foto es opcional. Se valida antes de tocar la IA para poder responder
    // con un 400 claro si el archivo no sirve.
    let image = null;
    try {
      image = parseImagePayload(req.body.image);
    } catch (imageError) {
      return res.status(400).json({ error: imageError.message });
    }

    // Se admite texto solo, foto sola, o ambos; nunca ninguno de los dos.
    if (!foodText && !image) {
      return res.status(400).json({ error: 'Escribe al menos un alimento o adjuntá una foto.' });
    }

    if (foodText.length > 2_000) {
      return res.status(400).json({ error: 'El texto no puede superar 2000 caracteres.' });
    }

    // Permitir opcionalmente loggedAt (ej. pruebas automatizadas o ajuste de fecha)
    const loggedAt = req.body.loggedAt ? new Date(req.body.loggedAt).toISOString() : new Date().toISOString();

    // Una sola estimación: el texto y la foto se envían juntos al modelo y
    // producen un único desglose nutricional.
    const analysis = req.body.parsed_data || (await analyzeFood(foodText, image));
    const { data, error } = await supabase
      .from('daily_logs')
      .insert({
        user_id: userId,
        food_text: foodText || PHOTO_ONLY_LABEL,
        parsed_data: analysis,
        logged_at: loggedAt,
      })
      .select('id, food_text, parsed_data, logged_at')
      .single();

    if (error) throw error;

    // Actualizar/reconciliar cierre diario de la fecha del log
    const mealDate = localDateInTZ(new Date(loggedAt));
    await closeDailySummary(userId, mealDate);

    const summary = await getDailySummary(userId);
    return res.status(201).json({
      entry: {
        id: data.id,
        foodText: data.food_text,
        loggedAt: data.logged_at,
        foods: data.parsed_data.foods,
        totals: data.parsed_data.totals,
      },
      summary,
    });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not save food log:', error.message);
    const isDatabaseError = error.message.includes('daily_logs') || error.message.includes('parsed_data');
    return res.status(isDatabaseError ? 500 : 502).json({
      error: isDatabaseError ? databaseMessage(error) : error.message,
    });
  }
});

// Actualizar una comida existente
app.put('/api/logs/:id', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const logId = req.params.id;

    const { data: existing, error: fetchError } = await supabase
      .from('daily_logs')
      .select('id, food_text, parsed_data, logged_at')
      .eq('id', logId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ error: 'Registro no encontrado.' });

    const newFoodText = req.body.foodText !== undefined ? String(req.body.foodText).trim() : existing.food_text;
    if (!newFoodText) {
      return res.status(400).json({ error: 'Escribe al menos un alimento.' });
    }
    if (newFoodText.length > 2_000) {
      return res.status(400).json({ error: 'El texto no puede superar 2000 caracteres.' });
    }

    let analysis = existing.parsed_data;
    if (req.body.parsed_data) {
      analysis = req.body.parsed_data;
    } else if (newFoodText !== existing.food_text) {
      analysis = await analyzeFood(newFoodText);
    }

    const newLoggedAt = req.body.loggedAt ? new Date(req.body.loggedAt).toISOString() : existing.logged_at;

    const { data: updated, error: updateError } = await supabase
      .from('daily_logs')
      .update({
        food_text: newFoodText,
        parsed_data: analysis,
        logged_at: newLoggedAt,
      })
      .eq('id', logId)
      .eq('user_id', userId)
      .select('id, food_text, parsed_data, logged_at')
      .single();

    if (updateError) throw updateError;

    // Reconciliar cierres de los días afectados
    const oldDate = localDateInTZ(new Date(existing.logged_at));
    const newDate = localDateInTZ(new Date(newLoggedAt));
    await closeDailySummary(userId, oldDate);
    if (newDate !== oldDate) {
      await closeDailySummary(userId, newDate);
    }

    const todaySummary = await getDailySummary(userId);
    return res.json({
      entry: {
        id: updated.id,
        foodText: updated.food_text,
        loggedAt: updated.logged_at,
        foods: updated.parsed_data.foods,
        totals: updated.parsed_data.totals,
      },
      summary: todaySummary,
    });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not update food log:', error.message);
    const isDatabaseError = error.message.includes('daily_logs') || error.message.includes('parsed_data');
    return res.status(isDatabaseError ? 500 : 502).json({
      error: isDatabaseError ? databaseMessage(error) : error.message,
    });
  }
});

// Eliminar una comida
app.delete('/api/logs/:id', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const logId = req.params.id;

    // Verificar que el log pertenezca al usuario
    const { data: existing, error: fetchError } = await supabase
      .from('daily_logs')
      .select('id, logged_at')
      .eq('id', logId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ error: 'Registro no encontrado.' });

    const logDate = localDateInTZ(new Date(existing.logged_at));

    const { error: deleteError } = await supabase
      .from('daily_logs')
      .delete()
      .eq('id', logId)
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    // Reconciliar resumen del día afectado
    await closeDailySummary(userId, logDate);

    const summary = await getDailySummary(userId);
    return res.json({ summary });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not delete food log:', error.message);
    return res.status(500).json({ error: 'No se pudo eliminar el registro.' });
  }
});

// ---------------------------------------------------------------------------
// HISTORIAL: Días con registros (para la vista de Resúmenes)
// ---------------------------------------------------------------------------
app.get('/api/history/days', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const limit = Math.min(Number(req.query.limit) || 30, 90);
    const before = req.query.before; // YYYY-MM-DD, para paginación

    // Obtenemos los logs ordenados por fecha descendente
    let query = supabase
      .from('daily_logs')
      .select('logged_at, parsed_data')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false });

    if (before) {
      const beforeRange = dateRangeForLocalDay(before);
      query = query.lt('logged_at', beforeRange.start);
    }

    const { data, error } = await query.limit(limit * 25);
    if (error) throw error;

    // Agrupar por día local en Uruguay
    const dayMap = new Map();
    for (const log of data || []) {
      const dayStr = localDateInTZ(new Date(log.logged_at));
      if (!dayMap.has(dayStr)) {
        dayMap.set(dayStr, {
          date: dayStr,
          mealCount: 0,
          totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        });
      }
      const day = dayMap.get(dayStr);
      day.mealCount++;
      const t = log.parsed_data?.totals || {};
      day.totals.calories += number(t.calories);
      day.totals.protein += number(t.protein);
      day.totals.carbs += number(t.carbs);
      day.totals.fat += number(t.fat);
    }

    // Excluir el día actual para que solo aparezcan días pasados
    const today = localDateInTZ();
    dayMap.delete(today);

    // Convertir a array y limitar
    const days = [...dayMap.values()].slice(0, limit);

    // Reconciliar en background los días devueltos en daily_summaries
    for (const d of days) {
      closeDailySummary(userId, d.date).catch(() => {});
    }

    return res.json({ days, today });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not get history days:', error.message);
    return res.status(500).json({ error: 'No se pudo obtener el historial.' });
  }
});

// ---------------------------------------------------------------------------
// RESUMEN SEMANAL: comidas agrupadas por día para una semana completa
// ---------------------------------------------------------------------------
app.get('/api/weekly-summary', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);

    // weekStart es el lunes de la semana pedida (YYYY-MM-DD)
    let weekStart = req.query.weekStart;

    if (!weekStart) {
      const now = new Date();
      const todayStr = localDateInTZ(now);
      weekStart = getMonday(todayStr);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'weekStart debe tener formato YYYY-MM-DD' });
    }

    // Calcular los 7 días de la semana (lunes a domingo)
    const weekDays = [];
    const startDate = new Date(`${weekStart}T12:00:00Z`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      weekDays.push(d.toISOString().slice(0, 10));
    }

    const weekEnd = weekDays[6]; // domingo
    const range = weekRangeForLocalDates(weekStart, weekEnd);

    const { data, error } = await supabase
      .from('daily_logs')
      .select('id, food_text, parsed_data, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', range.start)
      .lt('logged_at', range.end)
      .order('logged_at', { ascending: true });

    if (error) throw error;

    // Agrupar por día local en Uruguay
    const dayMap = new Map();
    for (const dateStr of weekDays) {
      dayMap.set(dateStr, {
        date: dateStr,
        entries: [],
        totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      });
    }

    for (const log of data || []) {
      const dayStr = localDateInTZ(new Date(log.logged_at));
      const day = dayMap.get(dayStr);
      if (!day) continue;

      const analysis = log.parsed_data || {};
      const entry = {
        id: log.id,
        foodText: log.food_text,
        loggedAt: log.logged_at,
        foods: Array.isArray(analysis.foods) ? analysis.foods : [],
        totals: analysis.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 },
      };
      day.entries.push(entry);
      day.totals.calories += number(entry.totals.calories);
      day.totals.protein += number(entry.totals.protein);
      day.totals.carbs += number(entry.totals.carbs);
      day.totals.fat += number(entry.totals.fat);
    }

    const days = weekDays.map((d) => dayMap.get(d));

    // Totales semanales
    const weekTotals = days.reduce(
      (sum, day) => ({
        calories: sum.calories + day.totals.calories,
        protein: sum.protein + day.totals.protein,
        carbs: sum.carbs + day.totals.carbs,
        fat: sum.fat + day.totals.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const totalMeals = days.reduce((sum, day) => sum + day.entries.length, 0);

    return res.json({
      weekStart,
      weekEnd,
      days,
      totals: weekTotals,
      totalMeals,
    });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not get weekly summary:', error.message);
    return res.status(500).json({ error: 'No se pudo obtener el resumen semanal.' });
  }
});

// ---------------------------------------------------------------------------
// PERFIL
// ---------------------------------------------------------------------------

async function estimateCalorieGoal(profile) {
  const dob = new Date(profile.date_of_birth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) {
    age--;
  }

  const content = `Datos del usuario:
Edad: ${age} años
Peso: ${profile.weight_kg} kg
Altura: ${profile.height_cm} cm
Sexo: ${profile.sex}
Objetivo: ${profile.goal}
Actividad semanal: ${profile.weekly_activity_description}`;

  try {
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Eres un asistente especializado en nutrición.
Calcula las calorías diarias recomendadas para el usuario basado en su edad, peso, altura, sexo, actividad semanal y objetivo.
Devuelve ÚNICAMENTE un número entero que represente la cantidad de calorías. No incluyas ningún otro texto, ni letras, ni JSON.`
        },
        { role: 'user', content }
      ],
    });

    const responseContent = completion.choices[0]?.message?.content || '';
    const match = responseContent.match(/\d+/);

    if (!match) {
      throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
    }

    const goal = Number(match[0]);
    if (!Number.isFinite(goal) || goal <= 0) {
      throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
    }

    return goal;
  } catch (err) {
    throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
  }
}

app.get('/api/profile', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return res.json({ profile: data || null });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not get profile:', error.message);
    return res.status(500).json({ error: 'No se pudo obtener el perfil.' });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const profileData = req.body;

    if (!profileData.name || !profileData.date_of_birth || !profileData.weight_kg || !profileData.height_cm || !profileData.sex || !profileData.weekly_activity_description || !profileData.goal) {
      return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    let daily_calorie_goal = null;
    let calorie_goal_updated_at = null;
    let goalError = null;

    try {
      daily_calorie_goal = await estimateCalorieGoal(profileData);
      calorie_goal_updated_at = new Date().toISOString();
    } catch (err) {
      console.error('Error estimating calorie goal:', err.message);
      goalError = 'El perfil se guardó, pero no se pudo calcular la meta calórica. Intenta calcularla de nuevo más tarde.';
    }

    const { data, error } = await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        name: String(profileData.name),
        date_of_birth: profileData.date_of_birth,
        weight_kg: Number(profileData.weight_kg),
        height_cm: Number(profileData.height_cm),
        sex: String(profileData.sex),
        weekly_activity_description: String(profileData.weekly_activity_description),
        goal: String(profileData.goal),
        daily_calorie_goal,
        calorie_goal_updated_at
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'El perfil ya existe.' });
      throw error;
    }

    return res.status(201).json({ profile: data, message: goalError });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not create profile:', error.message);
    return res.status(500).json({ error: 'No se pudo crear el perfil.' });
  }
});

app.put('/api/profile', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const profileData = req.body;

    if (!profileData.name || !profileData.date_of_birth || !profileData.weight_kg || !profileData.height_cm || !profileData.sex || !profileData.weekly_activity_description || !profileData.goal) {
      return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    let daily_calorie_goal = profileData.daily_calorie_goal;
    let calorie_goal_updated_at = profileData.calorie_goal_updated_at;
    let goalError = null;

    try {
      daily_calorie_goal = await estimateCalorieGoal(profileData);
      calorie_goal_updated_at = new Date().toISOString();
    } catch (err) {
      console.error('Error estimating calorie goal:', err.message);
      goalError = 'El perfil se guardó, pero no se pudo actualizar la meta calórica.';
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        name: String(profileData.name),
        date_of_birth: profileData.date_of_birth,
        weight_kg: Number(profileData.weight_kg),
        height_cm: Number(profileData.height_cm),
        sex: String(profileData.sex),
        weekly_activity_description: String(profileData.weekly_activity_description),
        goal: String(profileData.goal),
        daily_calorie_goal,
        calorie_goal_updated_at,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Perfil no encontrado.' });
      throw error;
    }

    return res.json({ profile: data, message: goalError });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not update profile:', error.message);
    return res.status(500).json({ error: 'No se pudo actualizar el perfil.' });
  }
});

app.post('/api/profile/goal', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);

    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado.' });

    const daily_calorie_goal = await estimateCalorieGoal(profile);
    const calorie_goal_updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('profiles')
      .update({
        daily_calorie_goal,
        calorie_goal_updated_at,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    return res.json({ profile: data });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not update goal:', error.message);
    return res.status(500).json({ error: 'No se pudo calcular la meta calórica.' });
  }
});

/**
 * Programa el cierre automático diario exactamente a las 00:00:00 hora de Uruguay (America/Montevideo, UTC-3).
 */
function scheduleMidnightClosingUY() {
  const msToMidnight = msUntilNextMidnightUY();
  console.log(`[Cierre Diario UY] Próximo cierre de día programado en ${(msToMidnight / 3600000).toFixed(2)} horas (a las 00:00:00 America/Montevideo)`);

  const timer = setTimeout(async () => {
    try {
      const yesterday = getYesterdayInTZ();
      console.log(`[Cierre Diario UY] Medianoche 00:00 en Uruguay alcanzada. Ejecutando cierre automático del día ${yesterday}...`);

      const range = dateRangeForLocalDay(yesterday);
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('user_id')
        .gte('logged_at', range.start)
        .lt('logged_at', range.end);

      const userIds = new Set((logs || []).map((l) => l.user_id));
      for (const uid of userIds) {
        await closeDailySummary(uid, yesterday);
      }
      console.log(`[Cierre Diario UY] Cierre de medianoche completado para ${userIds.size} usuario(s) en la fecha ${yesterday}.`);
    } catch (err) {
      console.error('[Cierre Diario UY] Error en el cierre automático nocturno:', err.message);
    } finally {
      scheduleMidnightClosingUY();
    }
  }, msToMidnight + 1000);

  return timer;
}

// ---------------------------------------------------------------------------
// Errores de parseo del cuerpo de la petición
//
// Por ejemplo, una foto más pesada que el límite permitido. Respondemos JSON
// (en lugar del HTML por defecto de Express) para que el cliente pueda mostrar
// un mensaje claro.
// ---------------------------------------------------------------------------
app.use((error, _req, res, next) => {
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El archivo es demasiado grande para enviarlo.' });
  }

  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'La solicitud enviada no es válida.' });
  }

  return next(error);
});

// ---------------------------------------------------------------------------
// Arranque
//
// En Vercel la app se ejecuta como una única Vercel Function (Fluid compute):
// Vercel importa el `app` exportado por defecto y se encarga del enrutado, así
// que NO debemos abrir un puerto ni dejar temporizadores largos vivos. Hacerlo
// durante el arranque hacía que el proceso del runtime se cayera y todas las
// peticiones devolvieran FUNCTION_INVOCATION_FAILED.
// ---------------------------------------------------------------------------
const isVercel = Boolean(process.env.VERCEL);

let serverInstance = null;
let midnightTimer = null;

if (!isVercel && process.env.NODE_ENV !== 'test') {
  serverInstance = app.listen(port, () => {
    console.log(`Eatbud API escuchando en http://localhost:${port}`);
    try {
      midnightTimer = scheduleMidnightClosingUY();
    } catch (error) {
      console.error('[Cierre Diario UY] No se pudo programar el cierre diario:', error.message);
    }
  });
}

// Vercel detecta el handler de Express a partir del export por defecto.
export default app;

export {
  app,
  serverInstance,
  midnightTimer,
  localDateInTZ,
  getYesterdayInTZ,
  msUntilNextMidnightUY,
  scheduleMidnightClosingUY,
  dateRangeForLocalDay,
  weekRangeForLocalDates,
  getMonday,
  getDailySummary,
  closeDailySummary,
  reconcilePastDays,
  supabase,
  parseAnalysis,
};
