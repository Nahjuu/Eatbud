import { useState, useEffect, useCallback } from 'react';
import Chat from './Chat';
import CalorieCounter from './CalorieCounter';

const apiUrl = import.meta.env.VITE_API_URL || '/api';
const emptySummary = {
  totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  entries: [],
};

function getUruguayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function msUntilNextMidnightUY() {
  const todayStr = getUruguayDate();
  const [y, m, d] = todayStr.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const [ty, tm, td] = tomorrowStr.split('-').map(Number);
  const midnightUtcMs = Date.UTC(ty, tm - 1, td, 3, 0, 0);
  return Math.max(1000, midnightUtcMs - Date.now());
}

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
  const [deleting, setDeleting] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async () => {
    setError('');
    try {
      setSummary(await requestSummary(session.access_token));
    } catch (requestError) {
      setError(requestError.message || t.errorLoad);
    }
  }, [session.access_token, t.errorLoad]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Cierre y reinicio automático de día cuando cambia la fecha en America/Montevideo
  useEffect(() => {
    const msToMidnight = msUntilNextMidnightUY();
    const timer = setTimeout(() => {
      loadSummary();
    }, msToMidnight + 1000);

    const interval = setInterval(() => {
      if (summary.date && summary.date !== getUruguayDate()) {
        loadSummary();
      }
    }, 30000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (summary.date && summary.date !== getUruguayDate()) {
          loadSummary();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [summary.date, loadSummary]);

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

  const startEditing = (entry) => {
    setEditingId(entry.id);
    setEditText(entry.foodText);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditText('');
  };

  const submitEdit = async (entryId) => {
    const trimmed = editText.trim();
    if (!trimmed || updating) return;

    setUpdating(true);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/logs/${entryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ foodText: trimmed }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);
      setSummary(data.summary);
      setEditingId(null);
      setEditText('');
    } catch (requestError) {
      setError(requestError.message || t.errorUpdate || 'No se pudo actualizar la comida.');
    } finally {
      setUpdating(false);
    }
  };

  const deleteEntry = async (entryId) => {
    if (deleting) return;
    if (!window.confirm(t.confirmDelete)) return;

    setDeleting(entryId);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/logs/${entryId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);
      setSummary(data.summary);
    } catch (requestError) {
      setError(requestError.message || t.errorDelete);
    } finally {
      setDeleting(null);
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
              <article className="relative rounded-[18px] border border-dark-border bg-dark-surface p-[18px] shadow-[0_18px_50px_rgba(0,0,0,.18)]" key={entry.id}>
                <div className="flex items-start justify-between gap-4 max-[560px]:flex-col max-[560px]:gap-[6px]">
                  <div className="min-w-0 flex-1">
                    {editingId === entry.id ? (
                      <div className="mb-2">
                        <input
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full rounded-xl border border-brand/40 bg-dark-bg p-2.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand"
                          placeholder={t.whatDidYouEat}
                          autoFocus
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => submitEdit(entry.id)}
                            disabled={updating}
                            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-dark-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {updating ? (t.savingEdit || 'Guardando...') : (t.saveEdit || 'Guardar')}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            disabled={updating}
                            className="rounded-lg border border-dark-border px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-dark-border/40"
                          >
                            {t.cancelEdit || 'Cancelar'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="mb-1 text-base font-bold leading-[1.45]">{entry.foodText}</h3>
                        <time className="block text-[.83rem] text-[#a8bdb6]" dateTime={entry.loggedAt}>
                          {new Date(entry.loggedAt).toLocaleTimeString(lang === 'es' ? 'es-UY' : 'en-US', {
                            timeZone: 'America/Montevideo',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </time>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 max-[560px]:self-start">
                    <strong className="whitespace-nowrap text-[#86efc2]">{format(entry.totals.calories)} kcal</strong>
                    
                    {/* Botón Editar */}
                    {editingId !== entry.id && (
                      <button
                        type="button"
                        onClick={() => startEditing(entry)}
                        title={t.editEntry || 'Editar'}
                        aria-label={t.editEntry || 'Editar'}
                        className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-400 transition-all duration-200 hover:bg-dark-border/60 hover:text-brand-light active:scale-90"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                          <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                        </svg>
                      </button>
                    )}

                    {/* Botón Eliminar */}
                    <button
                      type="button"
                      onClick={() => deleteEntry(entry.id)}
                      disabled={deleting === entry.id}
                      title={t.deleteEntry}
                      aria-label={t.deleteEntry}
                      className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-red-500 transition-all duration-200 hover:bg-red-500/15 hover:text-red-400 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deleting === entry.id ? (
                        <svg className="h-[18px] w-[18px] animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]">
                          <path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
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

