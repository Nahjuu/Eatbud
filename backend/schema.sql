DROP TABLE IF EXISTS daily_logs CASCADE;
DROP TABLE IF EXISTS daily_summaries CASCADE;
DROP TABLE IF EXISTS weekly_summaries CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS user_biases CASCADE;
DROP TABLE IF EXISTS weight_logs CASCADE;

-- Create daily_logs table (Updated to track calories)
CREATE TABLE daily_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    food_text TEXT NOT NULL,
    ai_estimated_calories INTEGER DEFAULT 0,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create daily_summaries table
CREATE TABLE daily_summaries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    conclusion_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create weekly_summaries table
CREATE TABLE weekly_summaries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    week_start_date DATE NOT NULL,
    summary_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- (NEW TABLES FOR AI COGNITIVE BIAS TRACKING)

-- Create user_profiles table (Tracks TDEE and baseline metrics)
CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY DEFAULT 'anonymous',
    age INTEGER NOT NULL DEFAULT 30,
    height_cm INTEGER NOT NULL DEFAULT 170,
    weight_kg NUMERIC NOT NULL DEFAULT 70.0,
    activity_multiplier NUMERIC NOT NULL DEFAULT 1.2, -- 1.2 sedentary, 1.55 moderate, etc.
    tdee_kcal INTEGER NOT NULL DEFAULT 2000,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create user_biases table (The Secret Report)
CREATE TABLE user_biases (
    user_id TEXT PRIMARY KEY DEFAULT 'anonymous',
    global_multiplier NUMERIC DEFAULT 1.0,
    proteins_multiplier NUMERIC DEFAULT 1.0,
    carbs_multiplier NUMERIC DEFAULT 1.0,
    fats_multiplier NUMERIC DEFAULT 1.0,
    confidence_score INTEGER DEFAULT 0, -- Increases every calibration cycle
    last_calibrated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create weight_logs table (To track weight changes for the math check)
CREATE TABLE weight_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    weight_kg NUMERIC NOT NULL,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert a default anonymous profile and bias row for easy local testing
INSERT INTO user_profiles (user_id, age, height_cm, weight_kg, activity_multiplier, tdee_kcal) 
VALUES ('anonymous', 30, 175, 75.0, 1.2, 2100) ON CONFLICT DO NOTHING;

INSERT INTO user_biases (user_id, global_multiplier, proteins_multiplier, carbs_multiplier, fats_multiplier, confidence_score) 
VALUES ('anonymous', 1.0, 1.0, 1.0, 1.0, 0) ON CONFLICT DO NOTHING;
