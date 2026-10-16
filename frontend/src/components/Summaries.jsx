import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Utensils, Flame, ChevronDown, ChevronUp, Trash2, Edit2 } from 'lucide-react';
import { apiUrl } from '../apiUrl';

function format(value) {
  return Math.round(value || 0);
}

// ─── Comparación con la meta calórica ────────────────────────────────────────
// Las calorías consumidas se comparan con la meta diaria del perfil: verde
// mientras no se pasa, amarillo si se pasa por menos de 300 kcal y rojo si se
// pasa por más. Dentro de cada tramo el tono se intensifica de forma
// progresiva, así el color avisa antes de llegar al límite.
const OVER_LIMIT_KCAL = 300; // kcal de más (por día) que marcan el paso a rojo

function getGoalStatus(consumed, goal, overLimitKcal = OVER_LIMIT_KCAL) {
  const eaten = format(consumed);
  const target = format(goal);
  if (!target || target <= 0 || overLimitKcal <= 0) return null;

  const diff = eaten - target; // negativo: déficit; positivo: exceso
  const progress = (eaten / target) * 100;
  const ratio = diff / overLimitKcal; // cuánto se pasa, relativo al límite

  let level;
  let textClass;
  let barClass;
  let pillClass;

  if (diff <= 0) {
    // Dentro del límite: cuanto más cerca de la meta, más intenso el verde.
    level = 'ok';
    const nearGoal = progress >= 90;
    textClass = nearGoal ? 'text-emerald-300' : 'text-[#86efc2]';
    barClass = nearGoal ? 'bg-emerald-300' : 'bg-[#86efc2]';
    pillClass = nearGoal ? 'bg-emerald-300/15 text-emerald-300' : 'bg-[#86efc2]/15 text-[#86efc2]';
  } else if (diff <= overLimitKcal) {
    // Amarillo progresivo: sube de tono a medida que se acerca al límite.
    level = 'over';
    if (ratio <= 1 / 3) {
      textClass = 'text-yellow-300';
      barClass = 'bg-yellow-300';
      pillClass = 'bg-yellow-300/15 text-yellow-300';
    } else if (ratio <= 2 / 3) {
      textClass = 'text-amber-400';
      barClass = 'bg-amber-400';
      pillClass = 'bg-amber-400/15 text-amber-400';
    } else {
      textClass = 'text-orange-400';
      barClass = 'bg-orange-400';
      pillClass = 'bg-orange-400/15 text-orange-400';
    }
  } else {
    // Rojo progresivo: cuanto más se pasa del límite, más oscuro.
    level = 'danger';
    if (ratio <= 1.5) {
      textClass = 'text-red-400';
      barClass = 'bg-red-400';
      pillClass = 'bg-red-400/15 text-red-400';
    } else if (ratio <= 2.2) {
      textClass = 'text-red-500';
      barClass = 'bg-red-500';
      pillClass = 'bg-red-500/15 text-red-500';
    } else {
      textClass = 'text-red-600';
      barClass = 'bg-red-600';
      pillClass = 'bg-red-600/15 text-red-600';
    }
  }

  return {
    eaten,
    target,
    diff,
    level,
    textClass,
    barClass,
    pillClass,
    barWidth: Math.min(progress, 100),
  };
}

/** Barra de progreso del comparativo, con el color del estado */
function GoalProgressBar({ status }) {
  if (!status) return null;

  return (
    <div className="mt-4 h-2 w-full overflow-hidden rounded-full border border-dark-border/50 bg-dark-bg">
      <div
        className={`h-full rounded-full transition-all duration-700 ease-out ${status.barClass}`}
        style={{ width: `${status.barWidth}%` }}
      />
    </div>
  );
}

/** Distintivo con la diferencia contra la meta (déficit o exceso) */
function GoalDiffPill({ status, t, label }) {
  if (!status) return null;

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[.72rem] font-bold ${status.pillClass}`}>
      {label ?? (status.diff <= 0 ? t.goalDeficit : t.goalExcess)} {format(Math.abs(status.diff))} kcal
    </span>
  );
}

/** Comparativo "consumido / meta" en una sola línea, con la meta atenuada */
function GoalComparison({ status, className = '', smallClassName = 'text-sm', children }) {
  if (!status) return null;

  return (
    <strong className={`block font-bold ${className} ${status.textClass}`}>
      {status.eaten}
      <span className={`font-semibold text-[#a8bdb6] ${smallClassName}`}> / {status.target}</span>
      {children}
    </strong>
  );
}

/** Dado un YYYY-MM-DD, devuelve el lunes de esa semana */
function getMonday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Devuelve los 7 días (lun-dom) a partir de un lunes */
function getWeekDays(mondayStr) {
  const days = [];
  const start = new Date(`${mondayStr}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Formatea una fecha para mostrar al usuario */
function formatDate(dateStr, lang) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString(lang === 'es' ? 'es-UY' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

function formatWeekRange(mondayStr, sundayStr, lang) {
  const locale = lang === 'es' ? 'es-UY' : 'en-US';
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const mon = new Date(`${mondayStr}T12:00:00Z`).toLocaleDateString(locale, opts);
  const sun = new Date(`${sundayStr}T12:00:00Z`).toLocaleDateString(locale, opts);
  return `${mon} – ${sun}`;
}

// ─── Sub-view: Daily History (list of days) ──────────────────────────────────

function DaysList({ lang, t, session, profile, onSelectDay }) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Meta diaria del perfil: si todavía no está calculada, cada día se muestra
  // sólo con sus calorías, como antes.
  const goal = profile?.daily_calorie_goal;

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/history/days?limit=30`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error);
        setDays(data.days || []);
      })
      .catch((err) => setError(err.message || t.errorLoad))
      .finally(() => setLoading(false));
  }, [session.access_token, t.errorLoad]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand/30 border-t-brand" />
      </div>
    );
  }

  if (error) {
    return <p className="text-center text-red-400 py-10">{error}</p>;
  }

  if (!days.length) {
    return (
      <div className="rounded-[18px] border border-dark-border bg-dark-surface p-6 text-center shadow-[0_18px_50px_rgba(0,0,0,.18)] sm:p-10">
        <Calendar size={40} className="mx-auto mb-4 text-[#a8bdb6] opacity-50" />
        <p className="text-[#a8bdb6]">{t.noHistory}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {days.map((day) => {
        const status = getGoalStatus(day.totals.calories, goal);

        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelectDay(day.date)}
            className="group w-full cursor-pointer rounded-[18px] border border-dark-border bg-dark-surface p-[18px] text-left shadow-[0_18px_50px_rgba(0,0,0,.18)] transition-all duration-200 hover:border-brand/40 hover:shadow-brand/5 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="mb-1 text-base font-bold capitalize leading-[1.45] text-slate-100">
                  {formatDate(day.date, lang)}
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-[.83rem] text-[#a8bdb6]">
                  <span className="flex items-center gap-1">
                    <Utensils size={13} />
                    {day.mealCount} {day.mealCount === 1 ? t.meal : t.meals}
                  </span>
                  <GoalDiffPill status={status} t={t} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  {status ? (
                    <GoalComparison status={status} className="text-lg" smallClassName="text-sm" />
                  ) : (
                    <strong className="block text-lg font-bold text-[#86efc2]">{format(day.totals.calories)}</strong>
                  )}
                  <span className="text-xs text-[#a8bdb6]">kcal</span>
                </div>
                <ChevronRight size={18} className="text-[#a8bdb6] transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </div>
            </div>
            <div className="mt-3 flex gap-4 border-t border-dark-border/60 pt-3 text-[.82rem] text-[#93afa6]">
              <span>{format(day.totals.protein)}g {t.protein}</span>
              <span>{format(day.totals.carbs)}g {t.carbs}</span>
              <span>{format(day.totals.fat)}g {t.fat}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Sub-view: Day Detail ────────────────────────────────────────────────────

function DayDetail({ date, lang, t, session, profile, onBack }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [updating, setUpdating] = useState(false);

  // Comparativo del día contra la meta diaria del perfil.
  const status = getGoalStatus(summary?.totals?.calories, profile?.daily_calorie_goal);

  const loadDay = useCallback(() => {
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/daily-summary?date=${date}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error);
        setSummary(data);
      })
      .catch((err) => setError(err.message || t.errorLoad))
      .finally(() => setLoading(false));
  }, [date, session.access_token, t.errorLoad]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  const handleDeleteEntry = async (entryId) => {
    if (deletingId) return;
    if (!window.confirm(t.confirmDelete)) return;

    setDeletingId(entryId);
    try {
      const res = await fetch(`${apiUrl}/logs/${entryId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadDay();
    } catch (err) {
      alert(err.message || t.errorDelete);
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (entry) => {
    setEditingId(entry.id);
    setEditText(entry.foodText);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleSubmitEdit = async (entryId) => {
    const trimmed = editText.trim();
    if (!trimmed || updating) return;

    setUpdating(true);
    try {
      const res = await fetch(`${apiUrl}/logs/${entryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ foodText: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditingId(null);
      setEditText('');
      loadDay();
    } catch (err) {
      alert(err.message || t.errorUpdate);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand/30 border-t-brand" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <BackButton onClick={onBack} t={t} />
        <p className="text-center text-red-400 py-10">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <BackButton onClick={onBack} t={t} />

      <div className="mb-6 overflow-hidden rounded-[18px] border border-dark-border bg-dark-surface shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="bg-[#0c3d31] p-6">
          <h3 className="text-lg font-bold capitalize text-slate-100">
            {formatDate(date, lang)}
          </h3>
          <div className="mt-3 flex flex-wrap gap-5">
            <div>
              <span className="block text-[.78rem] text-[#a8bdb6]">{t.calToday}</span>
              {status ? (
                <>
                  <GoalComparison status={status} className="text-2xl" smallClassName="text-base">
                    <small className="text-xs font-semibold text-[#a8bdb6]"> kcal</small>
                  </GoalComparison>
                  <div className="mt-2">
                    <GoalDiffPill status={status} t={t} />
                  </div>
                </>
              ) : (
                <strong className="text-2xl font-bold text-[#86efc2]">{format(summary.totals.calories)} <small className="text-sm">kcal</small></strong>
              )}
            </div>
            <div>
              <span className="block text-[.78rem] text-[#a8bdb6]">{t.protein}</span>
              <strong className="text-lg font-bold text-slate-100">{format(summary.totals.protein)}g</strong>
            </div>
            <div>
              <span className="block text-[.78rem] text-[#a8bdb6]">{t.carbs}</span>
              <strong className="text-lg font-bold text-slate-100">{format(summary.totals.carbs)}g</strong>
            </div>
            <div>
              <span className="block text-[.78rem] text-[#a8bdb6]">{t.fat}</span>
              <strong className="text-lg font-bold text-slate-100">{format(summary.totals.fat)}g</strong>
            </div>
          </div>
          <GoalProgressBar status={status} />
        </div>
      </div>

      {summary.entries.length ? (
        <div className="grid gap-3">
          {summary.entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              lang={lang}
              t={t}
              onDelete={() => handleDeleteEntry(entry.id)}
              isDeleting={deletingId === entry.id}
              isEditing={editingId === entry.id}
              editText={editText}
              setEditText={setEditText}
              onStartEdit={() => handleStartEdit(entry)}
              onCancelEdit={handleCancelEdit}
              onSubmitEdit={() => handleSubmitEdit(entry.id)}
              updating={updating}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-[18px] border border-dark-border bg-dark-surface p-[30px] text-center text-[#a8bdb6] shadow-[0_18px_50px_rgba(0,0,0,.18)]">
          {t.emptyLog}
        </p>
      )}
    </div>
  );
}

// ─── Sub-view: Weekly Dashboard ──────────────────────────────────────────────

function WeeklyDashboard({ lang, t, session, profile }) {
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
    return getMonday(todayStr);
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDays, setExpandedDays] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [updating, setUpdating] = useState(false);

  // Comparativo semanal: la meta diaria cubre los 7 días de la semana, así que
  // la meta semanal y el margen de 300 kcal se multiplican por 7 (misma
  // proporción que en el día).
  const dailyGoal = profile?.daily_calorie_goal;
  const weekStatus = getGoalStatus(
    data?.totals?.calories,
    dailyGoal ? dailyGoal * 7 : 0,
    OVER_LIMIT_KCAL * 7
  );

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const currentMonday = getMonday(todayStr);
  const isCurrentWeek = weekStart === currentMonday;

  const loadWeek = useCallback(() => {
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/weekly-summary?weekStart=${weekStart}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error);
        setData(d);
        // Expandir por defecto todos los días que contengan comidas
        const daysWithMeals = new Set(
          (d.days || [])
            .filter((day) => day.entries && day.entries.length > 0)
            .map((day) => day.date)
        );
        setExpandedDays(daysWithMeals);
      })
      .catch((err) => setError(err.message || t.errorLoad))
      .finally(() => setLoading(false));
  }, [weekStart, session.access_token, t.errorLoad]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const goToPrevWeek = () => {
    const d = new Date(`${weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  const goToNextWeek = () => {
    if (isCurrentWeek) return;
    const d = new Date(`${weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    const nextMonday = d.toISOString().slice(0, 10);
    if (nextMonday > currentMonday) return;
    setWeekStart(nextMonday);
  };

  const toggleDay = (dateStr) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const toggleAllDays = () => {
    if (!data || !data.days) return;
    const daysWithMeals = data.days.filter((d) => d.entries && d.entries.length > 0).map((d) => d.date);
    if (expandedDays.size >= daysWithMeals.length) {
      setExpandedDays(new Set());
    } else {
      setExpandedDays(new Set(daysWithMeals));
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (deletingId) return;
    if (!window.confirm(t.confirmDelete)) return;

    setDeletingId(entryId);
    try {
      const res = await fetch(`${apiUrl}/logs/${entryId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      loadWeek();
    } catch (err) {
      alert(err.message || t.errorDelete);
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (entry) => {
    setEditingId(entry.id);
    setEditText(entry.foodText);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleSubmitEdit = async (entryId) => {
    const trimmed = editText.trim();
    if (!trimmed || updating) return;

    setUpdating(true);
    try {
      const res = await fetch(`${apiUrl}/logs/${entryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ foodText: trimmed }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      setEditingId(null);
      setEditText('');
      loadWeek();
    } catch (err) {
      alert(err.message || t.errorUpdate);
    } finally {
      setUpdating(false);
    }
  };

  const weekDays = getWeekDays(weekStart);
  const sundayStr = weekDays[6];

  return (
    <div>
      {/* Navegación de semana */}
      <div className="mb-6 flex items-center justify-between gap-3 rounded-[18px] border border-dark-border bg-dark-surface p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <button
          type="button"
          onClick={goToPrevWeek}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-300 transition-colors hover:bg-dark-border hover:text-brand-light"
          aria-label={t.prevWeek}
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <span className="block text-sm font-bold text-slate-200 capitalize">
            {formatWeekRange(weekStart, sundayStr, lang)}
          </span>
          {isCurrentWeek && (
            <span className="text-xs text-brand">{t.currentWeek}</span>
          )}
        </div>
        <button
          type="button"
          onClick={goToNextWeek}
          disabled={isCurrentWeek}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-300 transition-colors hover:bg-dark-border hover:text-brand-light disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={t.nextWeek}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand/30 border-t-brand" />
        </div>
      )}

      {error && <p className="text-center text-red-400 py-10">{error}</p>}

      {!loading && !error && data && (
        <>
          {/* Totales semanales */}
          <div className="mb-5 overflow-hidden rounded-[18px] border border-dark-border bg-dark-surface shadow-[0_18px_50px_rgba(0,0,0,.18)]">
            <div className="bg-[#0c3d31] p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="block text-[.78rem] text-[#a8bdb6] mb-1">{t.weeklyTotal}</span>
                  {weekStatus ? (
                    <>
                      <GoalComparison status={weekStatus} className="text-2xl" smallClassName="text-base">
                        <small className="text-xs font-semibold text-[#a8bdb6]"> kcal</small>
                      </GoalComparison>
                      <p className={`mt-2 text-[.85rem] font-semibold ${weekStatus.textClass}`}>
                        {weekStatus.diff <= 0 ? t.weeklyDeficit : t.weeklyExcess}: {format(Math.abs(weekStatus.diff))} kcal
                      </p>
                    </>
                  ) : (
                    <strong className="text-2xl font-bold text-[#86efc2]">
                      {format(data.totals.calories)} <small className="text-sm">kcal</small>
                    </strong>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-sm sm:gap-5">
                  <div>
                    <span className="block text-[.73rem] text-[#a8bdb6]">{t.protein}</span>
                    <strong className="text-slate-100">{format(data.totals.protein)}g</strong>
                  </div>
                  <div>
                    <span className="block text-[.73rem] text-[#a8bdb6]">{t.carbs}</span>
                    <strong className="text-slate-100">{format(data.totals.carbs)}g</strong>
                  </div>
                  <div>
                    <span className="block text-[.73rem] text-[#a8bdb6]">{t.fat}</span>
                    <strong className="text-slate-100">{format(data.totals.fat)}g</strong>
                  </div>
                  <div>
                    <span className="block text-[.73rem] text-[#a8bdb6]">{t.totalMeals}</span>
                    <strong className="text-slate-100">{data.totalMeals}</strong>
                  </div>
                </div>
              </div>
              <GoalProgressBar status={weekStatus} />
            </div>
          </div>

          {/* Selector de expansión rápida */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#a8bdb6]">
              {data.totalMeals} {data.totalMeals === 1 ? t.meal : t.meals} {lang === 'es' ? 'en la semana' : 'this week'}
            </span>
            <button
              type="button"
              onClick={toggleAllDays}
              className="cursor-pointer border-0 bg-transparent text-xs font-semibold text-brand transition-colors hover:text-brand-light"
            >
              {expandedDays.size > 0 ? (t.collapseAll || 'Colapsar todos') : (t.expandAll || 'Expandir todos')}
            </button>
          </div>

          {/* Días de la semana */}
          <div className="grid gap-3">
            {data.days.map((day) => {
              const isExpanded = expandedDays.has(day.date);
              const hasMeals = day.entries.length > 0;
              const isToday = day.date === todayStr;
              const isFuture = day.date > todayStr;
              // Comparativo del día contra la meta diaria (sólo si hubo comidas).
              const dayStatus = hasMeals ? getGoalStatus(day.totals.calories, dailyGoal) : null;

              return (
                <div
                  key={day.date}
                  className={`overflow-hidden rounded-[18px] border transition-colors duration-200 shadow-[0_18px_50px_rgba(0,0,0,.18)] ${
                    isToday
                      ? 'border-brand/40 bg-dark-surface'
                      : 'border-dark-border bg-dark-surface'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleDay(day.date)}
                    className="w-full cursor-pointer border-0 bg-transparent p-[18px] text-left transition-colors hover:bg-dark-border/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[.95rem] font-bold capitalize text-slate-200">
                            {formatDate(day.date, lang)}
                          </h4>
                          {isToday && (
                            <span className="rounded-md bg-brand/20 px-2 py-0.5 text-[.7rem] font-bold text-brand">{t.today}</span>
                          )}
                          {isFuture && (
                            <span className="text-[.75rem] text-[#a8bdb6]">—</span>
                          )}
                        </div>
                        {hasMeals ? (
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-[.8rem] text-[#93afa6]">
                            <span>{day.entries.length} {day.entries.length === 1 ? t.meal : t.meals}</span>
                            <span>·</span>
                            <span>{format(day.totals.protein)}g P</span>
                            <span>{format(day.totals.carbs)}g C</span>
                            <span>{format(day.totals.fat)}g {lang === 'es' ? 'G' : 'F'}</span>
                            <GoalDiffPill status={dayStatus} t={t} />
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-[#a8bdb6]/70 italic">
                            {isFuture ? '—' : (t.noMealsThisDay || 'Sin comidas registradas')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {hasMeals && (
                          dayStatus ? (
                            <GoalComparison status={dayStatus} className="text-lg" smallClassName="text-xs">
                              <small className="text-xs font-semibold text-[#a8bdb6]"> kcal</small>
                            </GoalComparison>
                          ) : (
                            <strong className="text-lg font-bold text-[#86efc2]">
                              {format(day.totals.calories)} <small className="text-xs text-[#a8bdb6]">kcal</small>
                            </strong>
                          )
                        )}
                        {isExpanded ? (
                          <ChevronUp size={18} className="text-[#a8bdb6]" />
                        ) : (
                          <ChevronDown size={18} className="text-[#a8bdb6]" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Entradas expandidas */}
                  {isExpanded && (
                    <div className="border-t border-dark-border px-[18px] pb-[18px] pt-3">
                      {hasMeals ? (
                        <div className="grid gap-3">
                          {day.entries.map((entry) => (
                            <EntryCard
                              key={entry.id}
                              entry={entry}
                              lang={lang}
                              t={t}
                              compact
                              onDelete={() => handleDeleteEntry(entry.id)}
                              isDeleting={deletingId === entry.id}
                              isEditing={editingId === entry.id}
                              editText={editText}
                              setEditText={setEditText}
                              onStartEdit={() => handleStartEdit(entry)}
                              onCancelEdit={handleCancelEdit}
                              onSubmitEdit={() => handleSubmitEdit(entry.id)}
                              updating={updating}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="py-2 text-center text-xs text-[#a8bdb6]/60">
                          {t.noMealsThisDay || 'Sin comidas registradas en este día.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function EntryCard({
  entry,
  lang,
  t,
  compact = false,
  onDelete,
  isDeleting = false,
  isEditing = false,
  editText = '',
  setEditText,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  updating = false,
}) {
  return (
    <article className={`rounded-xl border border-dark-border/60 bg-dark-bg/50 ${compact ? 'p-3' : 'p-[18px]'}`}>
      <div className="flex items-start justify-between gap-4 max-[560px]:flex-col max-[560px]:gap-[6px]">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="mb-2">
              <input
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full rounded-lg border border-brand/40 bg-dark-surface p-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand"
                autoFocus
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onSubmitEdit}
                  disabled={updating}
                  className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-dark-bg hover:opacity-90 disabled:opacity-50"
                >
                  {updating ? (t.savingEdit || 'Guardando...') : (t.saveEdit || 'Guardar')}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={updating}
                  className="rounded-lg border border-dark-border px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-dark-border/40"
                >
                  {t.cancelEdit || 'Cancelar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h4 className={`mb-1 font-bold leading-[1.45] ${compact ? 'text-[.9rem]' : 'text-base'}`}>
                {entry.foodText}
              </h4>
              <time className="block text-[.78rem] text-[#a8bdb6]" dateTime={entry.loggedAt}>
                {new Date(entry.loggedAt).toLocaleTimeString(lang === 'es' ? 'es-UY' : 'en-US', {
                  timeZone: 'America/Montevideo',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 max-[560px]:self-start">
          <strong className="whitespace-nowrap text-[#86efc2]">
            {format(entry.totals.calories)} kcal
          </strong>
          {onStartEdit && !isEditing && (
            <button
              type="button"
              onClick={onStartEdit}
              title={t.editEntry || 'Editar'}
              aria-label={t.editEntry || 'Editar'}
              className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-400 transition-colors hover:bg-dark-border/60 hover:text-brand-light active:scale-90"
            >
              <Edit2 size={13} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              title={t.deleteEntry}
              aria-label={t.deleteEntry}
              className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-red-500 transition-colors hover:bg-red-500/15 hover:text-red-400 active:scale-90 disabled:opacity-40"
            >
              {isDeleting ? (
                <div className="h-3 w-3 animate-spin rounded-full border border-red-400 border-t-transparent" />
              ) : (
                <Trash2 size={14} />
              )}
            </button>
          )}
        </div>
      </div>
      {entry.foods && entry.foods.length > 0 && (
        <ul className={`mt-3 grid list-none gap-[8px] border-t border-dark-border/50 pb-0 pl-0 pr-0 ${compact ? 'pt-2' : 'pt-3'}`}>
          {entry.foods.map((food, index) => (
            <li className="flex flex-col gap-[2px] text-[.84rem] text-[#d5e0dc]" key={`${entry.id}-${index}`}>
              <div className="flex items-start justify-between gap-4 max-[560px]:flex-col max-[560px]:gap-[2px]">
                <span>{food.name} · {format(food.quantity)} {food.unit}</span>
                <strong className="whitespace-nowrap text-[#86efc2]">{format(food.calories)} kcal</strong>
              </div>
              <span className="text-[#93afa6]">
                {format(food.protein)} P · {format(food.carbs)} C · {format(food.fat)} {lang === 'es' ? 'G' : 'F'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function BackButton({ onClick, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-5 flex cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent p-0 text-[.9rem] font-semibold text-brand transition-colors hover:text-brand-light"
    >
      <ChevronLeft size={18} />
      {t.back}
    </button>
  );
}

// ─── Main Summaries Component ────────────────────────────────────────────────

export default function Summaries({ lang, t, session, profile }) {
  const [subView, setSubView] = useState('tabs'); // 'tabs' | 'dayDetail'
  const [selectedDate, setSelectedDate] = useState(null);
  const [activeTab, setActiveTab] = useState('daily'); // 'daily' | 'weekly'

  const handleSelectDay = (date) => {
    setSelectedDate(date);
    setSubView('dayDetail');
  };

  const handleBack = () => {
    setSubView('tabs');
    setSelectedDate(null);
  };

  if (subView === 'dayDetail' && selectedDate) {
    return (
      <DayDetail
        date={selectedDate}
        lang={lang}
        t={t}
        session={session}
        profile={profile}
        onBack={handleBack}
      />
    );
  }

  return (
    <div>
      {/* Tab selector */}
      <div className="mb-6 flex overflow-hidden rounded-xl border border-dark-border bg-dark-surface">
        <button
          type="button"
          onClick={() => setActiveTab('daily')}
          className={`flex-1 cursor-pointer border-0 px-4 py-3 text-sm font-bold transition-colors ${
            activeTab === 'daily'
              ? 'bg-brand/15 text-brand-light border-b-2 border-brand'
              : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-dark-border/30'
          }`}
        >
          <Calendar size={16} className="mr-1.5 inline-block align-text-bottom" />
          {t.dailyHistory}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('weekly')}
          className={`flex-1 cursor-pointer border-0 px-4 py-3 text-sm font-bold transition-colors ${
            activeTab === 'weekly'
              ? 'bg-brand/15 text-brand-light border-b-2 border-brand'
              : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-dark-border/30'
          }`}
        >
          <Flame size={16} className="mr-1.5 inline-block align-text-bottom" />
          {t.weeklyView}
        </button>
      </div>

      {activeTab === 'daily' ? (
        <DaysList lang={lang} t={t} session={session} profile={profile} onSelectDay={handleSelectDay} />
      ) : (
        <WeeklyDashboard lang={lang} t={t} session={session} profile={profile} />
      )}
    </div>
  );
}
