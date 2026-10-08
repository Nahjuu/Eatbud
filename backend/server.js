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
const model = process.env.GROQ_MODEL && process.env.GROQ_MODEL !== 'groq/compound-mini'
  ? process.env.GROQ_MODEL
  : 'llama3-8b-8192';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function getUserFromReq(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error('Unauthorized');
  }
  return user.id;
}

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
    throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
  }

  const response = JSON.parse(content.slice(start, end + 1));
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

async function getDailySummary(userId, date) {
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
  try {
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
  } catch (err) {
    throw new Error('Eatbud no puede calcular en estos momentos, vuelve a intentarlo o intentalo más tarde.');
  }
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
    const userId = await getUserFromReq(req);
    return res.json(await getDailySummary(userId, req.query.date));
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Could not get daily summary:', error.message);
    return res.status(500).json({ error: databaseMessage(error) });
  }
});

app.post('/api/logs', async (req, res) => {
  try {
    const userId = await getUserFromReq(req);
    const foodText = String(req.body.foodText || '').trim();

    if (!foodText) {
      return res.status(400).json({ error: 'Escribe al menos un alimento.' });
    }

    if (foodText.length > 2_000) {
      return res.status(400).json({ error: 'El texto no puede superar 2000 caracteres.' });
    }

    const analysis = await analyzeFood(foodText);
    const { data, error } = await supabase
      .from('daily_logs')
      .insert({ user_id: userId, food_text: foodText, parsed_data: analysis })
      .select('id, food_text, parsed_data, logged_at')
      .single();

    if (error) throw error;

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

app.listen(port, () => {
  console.log(`Eatbud API escuchando en http://localhost:${port}`);
});
