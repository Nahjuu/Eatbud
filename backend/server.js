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

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Groq Client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 1. POST /api/logs
// Adds a raw food entry for the day
app.post('/api/logs', async (req, res) => {
  try {
    const { food_text, user_id = 'anonymous' } = req.body;
    
    if (!food_text) {
      return res.status(400).json({ error: 'food_text is required' });
    }

    const { data, error } = await supabase
      .from('daily_logs')
      .insert([{ food_text, user_id }])
      .select();

    if (error) throw error;
    
    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Error inserting log:', error);
    res.status(500).json({ error: 'Failed to insert log' });
  }
});

// 2. POST /api/daily-summary
// Fetches all logs for today, analyzes with Groq, and saves the summary
app.post('/api/daily-summary', async (req, res) => {
  try {
    const { user_id = 'anonymous' } = req.body;
    
    // Get today's start and end timestamps (UTC for simplicity)
    const startOfDay = new Date();
    startOfDay.setUTCHours(0,0,0,0);
    const endOfDay = new Date();
    endOfDay.setUTCHours(23,59,59,999);

    // Fetch logs from DB
    const { data: logs, error: dbError } = await supabase
      .from('daily_logs')
      .select('food_text')
      .eq('user_id', user_id)
      .gte('logged_at', startOfDay.toISOString())
      .lte('logged_at', endOfDay.toISOString());

    if (dbError) throw dbError;

    if (!logs || logs.length === 0) {
      return res.status(404).json({ message: 'No logs found for today' });
    }

    // Prepare data for Groq
    const foodList = logs.map(log => log.food_text).join(', ');
    
    const prompt = `Eres un nutricionista analizando el consumo de hoy. Este es el registro crudo de lo que comió el usuario: ${foodList}. Haz un resumen de 3 líneas destacando aciertos y fallos. Responde únicamente con el resumen, sin introducciones.`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
    });

    const conclusion_text = chatCompletion.choices[0].message.content;

    // Save summary to DB
    const { data: summaryData, error: summaryError } = await supabase
      .from('daily_summaries')
      .insert([{ user_id, conclusion_text }])
      .select();
      
    if (summaryError) throw summaryError;

    res.json({ success: true, data: summaryData });
  } catch (error) {
    console.error('Error generating daily summary:', error);
    res.status(500).json({ error: 'Failed to generate daily summary' });
  }
});

// 3. POST /api/weekly-summary
// Fetches last 7 daily summaries, analyzes with Groq, saves weekly summary, and cleans up daily logs
app.post('/api/weekly-summary', async (req, res) => {
  try {
    const { user_id = 'anonymous' } = req.body;
    
    // Get date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Fetch daily summaries for the past 7 days
    const { data: summaries, error: dbError } = await supabase
      .from('daily_summaries')
      .select('conclusion_text, date')
      .eq('user_id', user_id)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0]);

    if (dbError) throw dbError;

    if (!summaries || summaries.length === 0) {
      return res.status(404).json({ message: 'No daily summaries found for the past week' });
    }

    // Prepare data for Groq
    const summaryList = summaries.map(s => `Día ${s.date}: ${s.conclusion_text}`).join('\n');
    
    const prompt = `Aquí tienes los resúmenes diarios de alimentación de esta semana de un usuario:\n${summaryList}\nEscribe una conclusión general en un párrafo y una meta accionable para la próxima semana.`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
    });

    const summary_text = chatCompletion.choices[0].message.content;
    const week_start_date = sevenDaysAgo.toISOString().split('T')[0];

    // Save weekly summary to DB
    const { data: weeklyData, error: weeklyError } = await supabase
      .from('weekly_summaries')
      .insert([{ user_id, week_start_date, summary_text }])
      .select();
      
    if (weeklyError) throw weeklyError;

    // Purge old daily_logs to simulate data lifecycle (delete logs older than 7 days)
    const { error: purgeError } = await supabase
      .from('daily_logs')
      .delete()
      .eq('user_id', user_id)
      .lte('logged_at', sevenDaysAgo.toISOString());
      
    if (purgeError) console.error('Warning: Failed to purge old logs', purgeError);

    res.json({ success: true, data: weeklyData });
  } catch (error) {
    console.error('Error generating weekly summary:', error);
    res.status(500).json({ error: 'Failed to generate weekly summary' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
});
