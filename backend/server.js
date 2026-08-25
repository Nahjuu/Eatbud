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
const userId = 'anonymous';
const model = process.env.GROQ_MODEL || 'groq/compound-mini';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10kb' }));

function dateRange(date) {
  const value = date || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('La fecha debe tener formato YYYY-MM-DD');
  }

  const start = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(start.valueOf())) {
    throw new Error('La fecha no es válida');
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { value, start: start.toISOString(), end: end.toISOString() };
}

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
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new Error('Groq no devolvió un objeto JSON');
  }

  const response = JSON.parse(content.slice(start, end + 1));
  const foods = Array.isArray(response.foods) ? response.foods : [];

  if (!foods.length) {
    throw new Error('Groq no encontró alimentos en el texto');
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

async function getDailySummary(date) {
  const range = dateRange(date);
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

async function analyzeFood(foodText) {
  const completion = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: 'Devuelve solo JSON válido: {"foods":[{"name":"","quantity":0,"unit":"","calories":0,"protein":0,"carbs":0,"fat":0}]}.',
      },
      { role: 'user', content: foodText },
    ],
  });

  return parseAnalysis(completion.choices[0]?.message?.content || '');
}

app.get('/api/health', async (_req, res) => {
  const { error } = await supabase.from('daily_logs').select('id, parsed_data').limit(1);

  if (error) {
    console.error('Supabase health check failed:', error.message);
    return res.status(503).json({ ok: false, database: false, error: databaseMessage(error) });
  }

  return res.json({ ok: true, database: true, model });
});

app.get('/api/daily-summary', async (req, res) => {
  try {
    return res.json(await getDailySummary(req.query.date));
  } catch (error) {
    console.error('Could not get daily summary:', error.message);
    return res.status(500).json({ error: databaseMessage(error) });
  }
});

app.post('/api/logs', async (req, res) => {
  const foodText = String(req.body.foodText || '').trim();

  if (!foodText) {
    return res.status(400).json({ error: 'Escribe al menos un alimento.' });
  }

  if (foodText.length > 2_000) {
    return res.status(400).json({ error: 'El texto no puede superar 2000 caracteres.' });
  }

  try {
    const analysis = await analyzeFood(foodText);
    const { data, error } = await supabase
      .from('daily_logs')
      .insert({ user_id: userId, food_text: foodText, parsed_data: analysis })
      .select('id, food_text, parsed_data, logged_at')
      .single();

    if (error) throw error;

    const summary = await getDailySummary();
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
    console.error('Could not save food log:', error.message);
    const isDatabaseError = error.message.includes('daily_logs') || error.message.includes('parsed_data');
    return res.status(isDatabaseError ? 500 : 502).json({
      error: isDatabaseError ? databaseMessage(error) : 'Groq no pudo analizar la comida. Inténtalo de nuevo.',
    });
  }
});

app.listen(port, () => {
  console.log(`Eatbud API escuchando en http://localhost:${port}`);
});
