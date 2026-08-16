# Eatbud 🥗🤖

Eatbud is an AI-powered smart calorie and food tracking application. Instead of manually counting calories and trying to understand complex nutritional labels, you simply write down what you ate in plain text (e.g., "1 large apple, 100g chicken breast"). Eatbud processes your daily logs and utilizes advanced AI models to give you instant, personalized daily nutritional insights and comprehensive weekly summaries.

## ✨ Features

- **Natural Language Logging:** Log your food exactly how you speak. No need to search through endless databases.
- **AI Daily Insights:** Get immediate feedback on your daily macronutrient balance and eating habits.
- **Weekly Performance Reviews:** Receive an automated weekly summary with actionable goals to improve your diet.
- **Smart Data Management:** Old daily logs are automatically compiled and purged after the weekly review, keeping the system fast and clutter-free.

## 🚀 Tech Stack

Eatbud is built as a modern Full-Stack web application:

### Frontend
- **React** (powered by Vite) for a blazing fast, interactive user interface.
- **Tailwind CSS** for clean, responsive, and modern styling.

### Backend & Infrastructure
- **Node.js & Express:** A robust REST API that handles data processing and securely communicates with external AI services.
- **Supabase (PostgreSQL):** A highly scalable cloud database for secure user data and logging history.
- **Groq API (Llama 3.1):** State-of-the-art Large Language Model (LLM) used to analyze the nutritional value of raw food logs in milliseconds.

## 💡 The Goal

This project was built to solve the friction of traditional calorie tracking apps. By leveraging the speed of Groq and the reasoning capabilities of Llama 3, Eatbud removes the tediousness of manual data entry, providing a seamless and intelligent health-tracking experience.
