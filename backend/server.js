import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Groq Client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Utility to get USDA calories for a query
async function getBaselineCalories(query) {
  try {
    const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=1&api_key=${USDA_API_KEY}`);
    const data = await response.json();
    if (data.foods && data.foods.length > 0) {
      // Find energy (kcal) in nutrients
      const nutrients = data.foods[0].foodNutrients;
      const energy = nutrients.find(n => n.nutrientName.includes('Energy') && n.unitName === 'kcal');
      return energy ? energy.value : 100; // default 100 kcal per 100g if not found
    }
    return 100; // fallback baseline
  } catch (err) {
    console.error('USDA API Error:', err);
    return 100;
  }
}

// 1. POST /api/logs
app.post('/api/logs', async (req, res) => {
  try {
    const { food_text, user_id = 'anonymous' } = req.body;
    if (!food_text) return res.status(400).json({ error: 'food_text is required' });

    // Phase 3: Fetch Country Baseline using Groq to parse food name, then USDA for calories
    const parsePrompt = `Extrae únicamente el nombre genérico del alimento de este texto: "${food_text}". Ejemplo: "1 manzana grande" -> "apple". Responde solo con la palabra en inglés.`;
    const groqParse = await groq.chat.completions.create({
      messages: [{ role: "user", content: parsePrompt }],
      model: "llama-3.1-8b-instant",
    });
    const parsedFood = groqParse.choices[0].message.content.trim();
    
    // Fetch USDA baseline
    const baselineKcalPer100g = await getBaselineCalories(parsedFood);

    // Groq estimates baseline grams based on the text (e.g. "large apple" -> 220)
    const gramsPrompt = `Estima el peso en gramos de esta comida: "${food_text}". Responde únicamente con el número en gramos, sin texto adicional.`;
    const groqGrams = await groq.chat.completions.create({
      messages: [{ role: "user", content: gramsPrompt }],
      model: "llama-3.1-8b-instant",
    });
    const estimatedGrams = parseInt(groqGrams.choices[0].message.content.trim()) || 100;

    // Fetch User Biases (The Secret Report)
    const { data: biases } = await supabase.from('user_biases').select('*').eq('user_id', user_id).single();
    const globalMultiplier = biases ? biases.global_multiplier : 1.0;

    // Apply the multiplier silently
    const adjustedGrams = estimatedGrams * globalMultiplier;
    const ai_estimated_calories = Math.round((adjustedGrams / 100) * baselineKcalPer100g);

    // Save to DB
    const { data, error } = await supabase.from('daily_logs').insert([{ food_text, user_id, ai_estimated_calories }]).select();
    if (error) throw error;
    
    res.status(201).json({ 
      success: true, 
      data, 
      message: `Based on your usual portion perception, we estimate this at ~${Math.round(adjustedGrams)}g (${ai_estimated_calories} kcal).` 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to insert log' });
  }
});

// 2. POST /api/daily-summary
app.post('/api/daily-summary', async (req, res) => {
  try {
    const { user_id = 'anonymous' } = req.body;
    
    const startOfDay = new Date(); startOfDay.setUTCHours(0,0,0,0);
    const endOfDay = new Date(); endOfDay.setUTCHours(23,59,59,999);

    const { data: logs } = await supabase.from('daily_logs').select('*').eq('user_id', user_id).gte('logged_at', startOfDay.toISOString()).lte('logged_at', endOfDay.toISOString());
    const { data: biases } = await supabase.from('user_biases').select('confidence_score').eq('user_id', user_id).single();

    if (!logs || logs.length === 0) return res.status(404).json({ message: 'No logs found' });

    const totalKcal = logs.reduce((acc, log) => acc + log.ai_estimated_calories, 0);
    const foodList = logs.map(l => `${l.food_text} (~${l.ai_estimated_calories} kcal)`).join(', ');
    
    let prompt = `El usuario comió: ${foodList}. Total estimado: ${totalKcal} kcal. Haz un resumen nutricional breve. `;
    
    // Phase 4: Measurement Advice Layer
    if (biases && biases.confidence_score < 3) {
        prompt += `Agrega al final un mensaje de apoyo y amigable recomendando pesar la comida esta semana porque aún estamos calibrando sus estimaciones.`;
    } else {
        prompt += `Agrega un mensaje de apoyo diciendo que la calibración va excelente y que confías en sus porciones visuales.`;
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
    });

    const conclusion_text = chatCompletion.choices[0].message.content;

    const { data: summaryData, error: summaryError } = await supabase.from('daily_summaries').insert([{ user_id, conclusion_text }]).select();
    if (summaryError) throw summaryError;

    res.json({ success: true, data: summaryData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// 3. POST /api/weight
app.post('/api/weight', async (req, res) => {
    try {
        const { weight_kg, user_id = 'anonymous' } = req.body;
        const { data, error } = await supabase.from('weight_logs').insert([{ user_id, weight_kg }]).select();
        if (error) throw error;

        // Update user profile weight
        await supabase.from('user_profiles').update({ weight_kg, updated_at: new Date().toISOString() }).eq('user_id', user_id);

        res.json({ success: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to log weight' });
    }
});

// 4. POST /api/weekly-summary
app.post('/api/weekly-summary', async (req, res) => {
  try {
    const { user_id = 'anonymous' } = req.body;
    
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Phase 2: Calibration Algorithm
    const { data: profile } = await supabase.from('user_profiles').select('*').eq('user_id', user_id).single();
    const { data: biases } = await supabase.from('user_biases').select('*').eq('user_id', user_id).single();
    const { data: weightLogs } = await supabase.from('weight_logs').select('weight_kg').eq('user_id', user_id).gte('logged_at', sevenDaysAgo.toISOString()).order('logged_at', { ascending: true });
    
    let weight_change_kg = 0;
    if (weightLogs && weightLogs.length >= 2) {
        const firstWeight = weightLogs[0].weight_kg;
        const lastWeight = weightLogs[weightLogs.length - 1].weight_kg;
        weight_change_kg = lastWeight - firstWeight;
    }

    const { data: logsThisWeek } = await supabase.from('daily_logs').select('ai_estimated_calories').eq('user_id', user_id).gte('logged_at', sevenDaysAgo.toISOString());
    const ai_estimated_intake_weekly = logsThisWeek ? logsThisWeek.reduce((sum, log) => sum + log.ai_estimated_calories, 0) : 0;
    const ai_estimated_daily = ai_estimated_intake_weekly / 7;

    const tdee = profile ? profile.tdee_kcal : 2000;
    const actual_intake_daily = tdee + ((weight_change_kg * 7700) / 7);

    // Calculate New Bias
    let newMultiplier = biases ? biases.global_multiplier : 1.0;
    if (ai_estimated_daily > 0) {
        const rawNewBias = actual_intake_daily / ai_estimated_daily;
        // Smoothing formula: 70% old + 30% new
        newMultiplier = (newMultiplier * 0.7) + (rawNewBias * 0.3);
    }

    // Update Biases
    await supabase.from('user_biases').update({ 
        global_multiplier: newMultiplier,
        confidence_score: (biases ? biases.confidence_score : 0) + 1,
        last_calibrated_at: new Date().toISOString()
    }).eq('user_id', user_id);

    // Generate Weekly Summary
    const { data: summaries } = await supabase.from('daily_summaries').select('conclusion_text, date').eq('user_id', user_id).gte('date', sevenDaysAgo.toISOString().split('T')[0]);
    const summaryList = summaries ? summaries.map(s => `Día ${s.date}: ${s.conclusion_text}`).join('\n') : "No data.";
    
    let prompt = `Resúmenes de la semana:\n${summaryList}\n\nAdemás, el algoritmo detectó un cambio de peso de ${weight_change_kg}kg. `;
    prompt += `Escribe un reporte semanal para el usuario analizando esto y dándole una meta para la siguiente semana.`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
    });

    const summary_text = chatCompletion.choices[0].message.content;
    const week_start_date = sevenDaysAgo.toISOString().split('T')[0];

    // Save and Purge
    const { data: weeklyData } = await supabase.from('weekly_summaries').insert([{ user_id, week_start_date, summary_text }]).select();
    await supabase.from('daily_logs').delete().eq('user_id', user_id).lte('logged_at', sevenDaysAgo.toISOString());

    res.json({ success: true, new_multiplier: newMultiplier, data: weeklyData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate weekly summary' });
  }
});

// 5. POST /api/profile
// Sets up user profile, uses Groq to analyze natural language activity description to determine TDEE
app.post('/api/profile', async (req, res) => {
  try {
    const { user_id = 'anonymous', age, height_cm, weight_kg, gender = 'male', activity_description } = req.body;
    
    if (!activity_description) return res.status(400).json({ error: 'activity_description is required' });

    // Use Groq to determine the activity multiplier and TDEE based on the description
    const prompt = `Un usuario de ${age} años, ${height_cm} cm, ${weight_kg} kg, género ${gender}. Describe su semana promedio así: "${activity_description}". 
Usa la ecuación de Mifflin-St Jeor para calcular su BMR y luego estima su multiplicador de actividad física (usualmente entre 1.2 sedentario y 1.9 atleta profesional) basándote en su descripción.
Responde ÚNICAMENTE con un JSON válido con este formato: {"activity_multiplier": 1.55, "tdee_kcal": 2500}. No incluyas ningún otro texto o markdown.`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
    });

    let aiResponse;
    try {
        const textResponse = chatCompletion.choices[0].message.content.trim();
        // Sometimes the AI wraps it in markdown like ```json ... ```
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        aiResponse = JSON.parse(jsonMatch ? jsonMatch[0] : textResponse);
    } catch (e) {
        console.error('Error parsing Groq JSON:', e);
        return res.status(500).json({ error: 'AI failed to determine activity level' });
    }

    const { activity_multiplier, tdee_kcal } = aiResponse;

    // Update or insert profile
    const { data, error } = await supabase.from('user_profiles').upsert([{ 
        user_id, age, height_cm, weight_kg, activity_multiplier, tdee_kcal, updated_at: new Date().toISOString()
    }]).select();

    if (error) throw error;

    res.json({ success: true, data, message: `Groq analizó tu semana y te asignó un multiplicador de ${activity_multiplier} (TDEE: ${tdee_kcal} kcal).` });
  } catch (error) {
    console.error('Error in profile setup:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend avanzado corriendo en http://localhost:${PORT}`);
});
