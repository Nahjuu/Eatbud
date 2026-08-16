# Eatbud 🥗🤖

Eatbud is an AI-powered smart calorie and food tracking application. Instead of manually counting calories and trying to understand complex nutritional labels, you just write down what you ate in plain text (e.g., "1 large apple, 100g chicken breast"). Eatbud's backend processes your logs and utilizes LLM AI to give you instant, personalized daily nutritional insights and comprehensive weekly summaries.

## 🚀 Tech Stack

This project is a modern Full-Stack application designed to handle data safely, scale properly, and leverage serverless capabilities and external AI models.

**Frontend:**
- **React** (coming soon) 
- **Vite**
- **Tailwind CSS**

**Backend:**
- **Node.js & Express:** Robust REST API to serve as a secure intermediary between the client, database, and AI models.
- **Supabase (PostgreSQL):** Cloud database for secure and relational data storage.
- **Groq API (Llama 3.1):** Blazing fast LLM used to analyze raw food logs and provide nutritional summaries and weekly actionable goals.

## 🏗️ Architecture & Data Lifecycle

The application acts as an ETL (Extract, Transform, Load) pipeline:
1. **Log:** Users submit raw food text entries during the day via `POST /api/logs`.
2. **Daily Analysis:** At the end of the day, `POST /api/daily-summary` fetches the raw logs, injects them into a system prompt, and sends them to Groq's API. The AI's summary is stored in the database.
3. **Weekly Aggregation & Purging:** `POST /api/weekly-summary` compiles 7 days of AI summaries to generate a final weekly performance report. To optimize storage and respect data lifecycle best practices, old raw `daily_logs` are automatically purged after the weekly summary is generated.

## 🛠️ Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/YourUsername/eatbud.git
cd eatbud
```

### 2. Backend Setup
```bash
cd backend
npm install
```

Create a `.env` file in the `backend` folder with the following variables:
```env
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_secret_role_key
GROQ_API_KEY=your_groq_api_key
```

Execute the database setup script located at `backend/schema.sql` in your Supabase SQL Editor to create the required tables (`daily_logs`, `daily_summaries`, `weekly_summaries`).

Run the development server:
```bash
npm run dev
```

### 3. Frontend Setup
*(Frontend implementation in progress...)*

## 💡 Why this project?

This project was built to demonstrate proficiency in:
- Securing third-party API keys within a backend architecture.
- Database relational design and state management.
- Batch processing and data lifecycle management (purging volatile data).
- Prompt engineering and integrating Artificial Intelligence into a functional product.
