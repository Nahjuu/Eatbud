import { useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || '/api';

function format(value) {
  return Math.round(value || 0);
}

export default function CalorieCounter({ totals, t, session, profile, setProfile }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');

  if (!totals) return null;

  const retryGoal = async () => {
    if (retrying || !session) return;
    setRetrying(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/profile/goal`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setProfile(data.profile);
    } catch (err) {
      setError(err.message || t.errorCalculateGoal);
    } finally {
      setRetrying(false);
    }
  };

  const calories = format(totals.calories);
  const goal = profile?.daily_calorie_goal;
  
  let progress = 0;
  let barWidth = 0;
  let barColorClass = 'bg-[#86efc2]'; // verde por defecto
  
  if (goal && goal > 0) {
    progress = (calories / goal) * 100;
    barWidth = Math.min(progress, 100);
    
    if (progress >= 150) {
      barColorClass = 'bg-red-800';
    } else if (progress >= 125) {
      barColorClass = 'bg-red-700';
    } else if (progress >= 110) {
      barColorClass = 'bg-red-600';
    } else if (progress >= 100) {
      barColorClass = 'bg-red-500';
    } else if (progress >= 75) {
      barColorClass = 'bg-orange-400';
    }
  }

  return (
    <section className="mb-5 grid grid-cols-[1fr_1.3fr] overflow-hidden rounded-[18px] border border-dark-border bg-dark-surface shadow-[0_18px_50px_rgba(0,0,0,.18)] max-[560px]:grid-cols-1" aria-label="Resumen diario">
      <div className="bg-[#0c3d31] p-[26px] flex flex-col justify-center">
        <span className="block text-[.83rem] text-[#a8bdb6]">{t.calToday}</span>
        
        <div className="mt-[7px]">
          {goal ? (
            <div className="flex items-baseline gap-2">
              <strong className="block text-[2.2rem] font-bold tracking-[-.05em] text-slate-50">
                {calories}
              </strong>
              <span className="text-lg text-[#a8bdb6] font-semibold">/ {goal} <small className="text-sm">kcal</small></span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <strong className="block text-[2.2rem] font-bold tracking-[-.05em] text-[#86efc2]">
                {calories} <small className="text-base">kcal</small>
              </strong>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-300">{t.goalPending}</span>
                <button onClick={retryGoal} disabled={retrying} className="text-xs font-bold text-brand hover:text-brand-light disabled:opacity-50 transition-colors">
                  {retrying ? t.calculatingGoal : t.retryCalculateGoal}
                </button>
              </div>
              {error && <span className="text-xs text-red-400">{error}</span>}
            </div>
          )}
        </div>
        
        {goal > 0 && (
          <div className="mt-4 w-full h-2.5 bg-dark-bg rounded-full overflow-hidden border border-dark-border/50">
            <div 
              className={`h-full rounded-full transition-all duration-700 ease-out ${barColorClass}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-3 gap-4 px-[18px] py-[26px] max-[560px]:p-[18px]">
        <div>
          <span className="block text-[.83rem] text-[#a8bdb6]">{t.protein}</span>
          <strong className="mt-2 block text-[1.1rem] font-bold">{format(totals.protein)} g</strong>
        </div>
        <div>
          <span className="block text-[.83rem] text-[#a8bdb6]">{t.carbs}</span>
          <strong className="mt-2 block text-[1.1rem] font-bold">{format(totals.carbs)} g</strong>
        </div>
        <div>
          <span className="block text-[.83rem] text-[#a8bdb6]">{t.fat}</span>
          <strong className="mt-2 block text-[1.1rem] font-bold">{format(totals.fat)} g</strong>
        </div>
      </div>
    </section>
  );
}
