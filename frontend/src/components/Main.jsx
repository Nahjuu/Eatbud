import { useState, useEffect } from 'react';
import Chat from './Chat';
import CalorieCounter from './CalorieCounter';

const apiUrl = import.meta.env.VITE_API_URL || '/api';
const emptySummary = {
  totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  entries: [],
};

async function requestSummary(token) {
  const response = await fetch(`${apiUrl}/daily-summary`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();

  if (!response.ok) throw new Error(data.error);
  return data;
}

function format(value) {
  return Math.round(value || 0);
}

export default function Main({ lang, t, session, profile, setProfile }) {
  const [summary, setSummary] = useState(emptySummary);
  const [foodText, setFoodText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = async () => {
    setError('');
    try {
      setSummary(await requestSummary(session.access_token));
    } catch (requestError) {
      setError(requestError.message || t.errorLoad);
    }
  };

  useEffect(() => {
    requestSummary(session.access_token)
      .then(setSummary)
      .catch((requestError) => setError(requestError.message || t.errorLoad));
  }, [lang, t.errorLoad, session.access_token]);

  const saveFood = async (event) => {
    event.preventDefault();
    const text = foodText.trim();

    if (!text || saving) return;

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/logs`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
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
    <main>
      <CalorieCounter totals={totals} t={t} session={session} profile={profile} setProfile={setProfile} />
      
      <Chat 
        foodText={foodText} 
        setFoodText={setFoodText} 
        saving={saving} 
        saveFood={saveFood} 
        t={t} 
      />

      {error && <p className="mt-4 text-[#fecaca]" role="alert">{error}</p>}

      <section className="mt-[42px]">
        <div className="mb-[14px] flex items-center justify-between gap-4">
          <h2 className="m-0 text-[1.25rem] font-bold">{t.todayLog}</h2>
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[.9rem] text-brand disabled:cursor-not-allowed disabled:opacity-[.55]" onClick={loadSummary}>{t.refresh}</button>
        </div>

        {entries.length ? (
          <div className="grid gap-3">
            {entries.map((entry) => (
              <article className="rounded-[18px] border border-dark-border bg-dark-surface p-[18px] shadow-[0_18px_50px_rgba(0,0,0,.18)]" key={entry.id}>
                <div className="flex items-start justify-between gap-4 max-[560px]:flex-col max-[560px]:gap-[6px]">
                  <div>
                    <h3 className="mb-1 text-base font-bold leading-[1.45]">{entry.foodText}</h3>
                    <time className="block text-[.83rem] text-[#a8bdb6]" dateTime={entry.loggedAt}>
                      {new Date(entry.loggedAt).toLocaleTimeString(lang === 'es' ? 'es-UY' : 'en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </time>
                  </div>
                  <strong className="whitespace-nowrap text-[#86efc2] max-[560px]:self-start">{format(entry.totals.calories)} kcal</strong>
                </div>

                <ul className="mt-[18px] grid list-none gap-[10px] border-t border-dark-border pb-0 pl-0 pr-0 pt-[14px]">
                  {entry.foods.map((food, index) => (
                    <li className="flex items-start justify-between gap-4 text-[.88rem] text-[#d5e0dc] max-[560px]:flex-col max-[560px]:gap-[6px]" key={`${entry.id}-${index}`}>
                      <span>{food.name} · {format(food.quantity)} {food.unit}</span>
                      <span className="whitespace-nowrap text-[#93afa6]">{format(food.protein)} P · {format(food.carbs)} C · {format(food.fat)} {lang === 'es' ? 'G' : 'F'}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-[18px] border border-dark-border bg-dark-surface p-[30px] text-center text-[#a8bdb6] shadow-[0_18px_50px_rgba(0,0,0,.18)]">{t.emptyLog}</p>
        )}
      </section>
    </main>
  );
}
