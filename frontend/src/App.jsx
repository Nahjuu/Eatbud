import { useEffect, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || '/api';
const emptySummary = {
  totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  entries: [],
};

// 1. Create a dictionary for your translations
const translations = {
  es: {
    eyebrow: 'EATBUD',
    title: 'Tu alimentación, clara y simple.',
    intro: 'Escribe lo que comiste. Groq estima los nutrientes y se guarda en tu resumen diario.',
    calToday: 'Calorías de hoy',
    protein: 'Proteína',
    carbs: 'Carbohidratos',
    fat: 'Grasas',
    whatDidYouEat: '¿Qué comiste?',
    placeholder: 'Ej.: 200 g de pollo a la plancha, arroz y una manzana',
    analyzing: 'Analizando y guardando…',
    saveFood: 'Guardar comida',
    todayLog: 'Registro de hoy',
    refresh: 'Actualizar',
    emptyLog: 'Todavía no registraste comidas hoy.',
    errorLoad: 'No se pudo cargar el resumen del día.',
    errorSave: 'No se pudo guardar la comida.',
    langBtn: 'English'
  },
  en: {
    eyebrow: 'EATBUD',
    title: 'Your nutrition, clear and simple.',
    intro: 'Write down what you ate. Groq estimates the nutrients and saves them to your daily summary.',
    calToday: "Today's Calories",
    protein: 'Protein',
    carbs: 'Carbs',
    fat: 'Fat',
    whatDidYouEat: 'What did you eat?',
    placeholder: 'E.g.: 200g of grilled chicken, rice, and an apple',
    analyzing: 'Analyzing and saving...',
    saveFood: 'Save food',
    todayLog: "Today's Log",
    refresh: 'Refresh',
    emptyLog: "You haven't logged any food today.",
    errorLoad: "Could not load today's summary.",
    errorSave: 'Could not save the food.',
    langBtn: 'Español'
  }
};

function format(value) {
  return Math.round(value || 0);
}

async function requestSummary() {
  const response = await fetch(`${apiUrl}/daily-summary`);
  const data = await response.json();

  if (!response.ok) throw new Error(data.error);
  return data;
}

function App() {
  const [summary, setSummary] = useState(emptySummary);
  const [foodText, setFoodText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 2. Add state for the selected language
  const [lang, setLang] = useState('es');
  const t = translations[lang]; // Shortcut for current dictionary

  // 3. Toggle function for the button
  const toggleLanguage = () => {
    setLang((prev) => (prev === 'es' ? 'en' : 'es'));
    setError(''); // Clear errors on language switch to avoid translating old errors
  };

  const loadSummary = async () => {
    setError('');
    try {
      setSummary(await requestSummary());
    } catch (requestError) {
      setError(requestError.message || t.errorLoad);
    }
  };

  useEffect(() => {
    requestSummary()
      .then(setSummary)
      .catch((requestError) => setError(requestError.message || t.errorLoad));
  }, [lang]); // Added lang dependency so default error language updates

  const saveFood = async (event) => {
    event.preventDefault();
    const text = foodText.trim();

    if (!text || saving) return;

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foodText: text }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);
      setSummary(data.summary);
      setFoodText('');
    } catch (requestError) {
      setError(requestError.message || t.errorSave);
    } finally {
      setSaving(false);
    }
  };

  const { totals, entries } = summary;

  return (
    <main className="page">
      <header className="header">
        {/* Language Toggle Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button type="button" onClick={toggleLanguage} className="link-button">
            {t.langBtn}
          </button>
        </div>

        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p className="intro">{t.intro}</p>
      </header>

      <section className="summary" aria-label="Resumen diario">
        <div className="calories">
          <span>{t.calToday}</span>
          <strong>{format(totals.calories)} <small>kcal</small></strong>
        </div>
        <div className="macros">
          <div><span>{t.protein}</span><strong>{format(totals.protein)} g</strong></div>
          <div><span>{t.carbs}</span><strong>{format(totals.carbs)} g</strong></div>
          <div><span>{t.fat}</span><strong>{format(totals.fat)} g</strong></div>
        </div>
      </section>

      <form className="food-form" onSubmit={saveFood}>
        <label htmlFor="food">{t.whatDidYouEat}</label>
        <textarea
          id="food"
          value={foodText}
          onChange={(event) => setFoodText(event.target.value)}
          placeholder={t.placeholder}
          maxLength="2000"
          disabled={saving}
        />
        <button type="submit" disabled={saving || !foodText.trim()}>
          {saving ? t.analyzing : t.saveFood}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="history">
        <div className="section-title">
          <h2>{t.todayLog}</h2>
          <button type="button" className="link-button" onClick={loadSummary}>{t.refresh}</button>
        </div>

        {entries.length ? (
          <div className="entries">
            {entries.map((entry) => (
              <article className="entry" key={entry.id}>
                <div className="entry-heading">
                  <div>
                    <h3>{entry.foodText}</h3>
                    <time dateTime={entry.loggedAt}>
                      {/* Dynamic time formatting based on language */}
                      {new Date(entry.loggedAt).toLocaleTimeString(lang === 'es' ? 'es-UY' : 'en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </time>
                  </div>
                  <strong>{format(entry.totals.calories)} kcal</strong>
                </div>

                <ul className="foods">
                  {entry.foods.map((food, index) => (
                    <li key={`${entry.id}-${index}`}>
                      <span>{food.name} · {format(food.quantity)} {food.unit}</span>
                      {/* Using first letters for macros: P, C, F (Fat/Grasas) */}
                      <span>{format(food.protein)} P · {format(food.carbs)} C · {format(food.fat)} {lang === 'es' ? 'G' : 'F'}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">{t.emptyLog}</p>
        )}
      </section>
    </main>
  );
}

export default App;