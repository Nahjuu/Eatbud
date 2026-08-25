import { useEffect, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || '/api';
const emptySummary = {
  totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  entries: [],
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

  const loadSummary = async () => {
    setError('');

    try {
      setSummary(await requestSummary());
    } catch (requestError) {
      setError(requestError.message || 'No se pudo cargar el resumen del día.');
    }
  };

  useEffect(() => {
    requestSummary()
      .then(setSummary)
      .catch((requestError) => setError(requestError.message || 'No se pudo cargar el resumen del día.'));
  }, []);

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
      setError(requestError.message || 'No se pudo guardar la comida.');
    } finally {
      setSaving(false);
    }
  };

  const { totals, entries } = summary;

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">EATBUD</p>
        <h1>Tu alimentación, clara y simple.</h1>
        <p className="intro">Escribe lo que comiste. Groq estima los nutrientes y se guarda en tu resumen diario.</p>
      </header>

      <section className="summary" aria-label="Resumen diario">
        <div className="calories">
          <span>Calorías de hoy</span>
          <strong>{format(totals.calories)} <small>kcal</small></strong>
        </div>
        <div className="macros">
          <div><span>Proteína</span><strong>{format(totals.protein)} g</strong></div>
          <div><span>Carbohidratos</span><strong>{format(totals.carbs)} g</strong></div>
          <div><span>Grasas</span><strong>{format(totals.fat)} g</strong></div>
        </div>
      </section>

      <form className="food-form" onSubmit={saveFood}>
        <label htmlFor="food">¿Qué comiste?</label>
        <textarea
          id="food"
          value={foodText}
          onChange={(event) => setFoodText(event.target.value)}
          placeholder="Ej.: 200 g de pollo a la plancha, arroz y una manzana"
          maxLength="2000"
          disabled={saving}
        />
        <button type="submit" disabled={saving || !foodText.trim()}>
          {saving ? 'Analizando y guardando…' : 'Guardar comida'}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="history">
        <div className="section-title">
          <h2>Registro de hoy</h2>
          <button type="button" className="link-button" onClick={loadSummary}>Actualizar</button>
        </div>

        {entries.length ? (
          <div className="entries">
            {entries.map((entry) => (
              <article className="entry" key={entry.id}>
                <div className="entry-heading">
                  <div>
                    <h3>{entry.foodText}</h3>
                    <time dateTime={entry.loggedAt}>
                      {new Date(entry.loggedAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  <strong>{format(entry.totals.calories)} kcal</strong>
                </div>

                <ul className="foods">
                  {entry.foods.map((food, index) => (
                    <li key={`${entry.id}-${index}`}>
                      <span>{food.name} · {format(food.quantity)} {food.unit}</span>
                      <span>{format(food.protein)} P · {format(food.carbs)} C · {format(food.fat)} G</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">Todavía no registraste comidas hoy.</p>
        )}
      </section>
    </main>
  );
}

export default App;
