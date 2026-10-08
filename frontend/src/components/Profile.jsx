import { useState, useEffect } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || '/api';

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return '';
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export default function Profile({ session, profile, setProfile, t, isFirstTime = false, onComplete }) {
  const [isEditing, setIsEditing] = useState(isFirstTime);
  const [formData, setFormData] = useState({
    name: profile?.name || '',
    date_of_birth: profile?.date_of_birth || '',
    weight_kg: profile?.weight_kg || '',
    height_cm: profile?.height_cm || '',
    sex: profile?.sex || '',
    weekly_activity_description: profile?.weekly_activity_description || '',
    goal: profile?.goal || ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Sync form data if profile changes and we are not editing
  useEffect(() => {
    if (!isEditing && profile) {
      setFormData({
        name: profile.name || '',
        date_of_birth: profile.date_of_birth || '',
        weight_kg: profile.weight_kg || '',
        height_cm: profile.height_cm || '',
        sex: profile.sex || '',
        weekly_activity_description: profile.weekly_activity_description || '',
        goal: profile.goal || ''
      });
    }
  }, [profile, isEditing]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const method = profile ? 'PUT' : 'POST';
      const response = await fetch(`${apiUrl}/profile`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(formData)
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);
      
      setProfile(data.profile);
      setIsEditing(false);
      if (onComplete) onComplete();
      if (!isFirstTime) setSuccess(t.profileUpdated);
    } catch (err) {
      setError(err.message || 'Error al guardar el perfil');
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="w-full max-w-2xl mx-auto overflow-hidden rounded-[18px] border border-dark-border bg-dark-surface shadow-[0_18px_50px_rgba(0,0,0,.18)] animate-fade-in-up">
        <div className="border-b border-dark-border bg-[#0c3d31]/80 p-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-brand-light">
            {isFirstTime ? t.completeProfile : t.editProfile}
          </h2>
          {isFirstTime && <p className="text-sm text-slate-300 mt-2">{t.completeProfileHint}</p>}
        </div>

        <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-sm font-bold text-slate-200">{t.nameLabel}</label>
              <input id="name" name="name" type="text" value={formData.name} onChange={handleChange} disabled={saving} className="w-full rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="date_of_birth" className="text-sm font-bold text-slate-200">{t.dobLabel}</label>
              <input id="date_of_birth" name="date_of_birth" type="date" max={new Date().toISOString().split('T')[0]} value={formData.date_of_birth} onChange={handleChange} disabled={saving} className="w-full rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="weight_kg" className="text-sm font-bold text-slate-200">{t.weightLabel}</label>
              <input id="weight_kg" name="weight_kg" type="number" step="0.1" min="1" value={formData.weight_kg} onChange={handleChange} disabled={saving} className="w-full rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="height_cm" className="text-sm font-bold text-slate-200">{t.heightLabel}</label>
              <input id="height_cm" name="height_cm" type="number" step="1" min="1" value={formData.height_cm} onChange={handleChange} disabled={saving} className="w-full rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required />
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <label htmlFor="sex" className="text-sm font-bold text-slate-200">{t.sexLabel}</label>
              <select id="sex" name="sex" value={formData.sex} onChange={handleChange} disabled={saving} className="w-full rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required>
                <option value="" disabled>Selecciona...</option>
                <option value="male">{t.sexMale}</option>
                <option value="female">{t.sexFemale}</option>
                <option value="other">{t.sexOther}</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <label htmlFor="goal" className="text-sm font-bold text-slate-200">{t.goalLabel}</label>
              <select id="goal" name="goal" value={formData.goal} onChange={handleChange} disabled={saving} className="w-full rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required>
                <option value="" disabled>Selecciona...</option>
                <option value="lose">{t.goalLose}</option>
                <option value="maintain">{t.goalMaintain}</option>
                <option value="gain">{t.goalGain}</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <label htmlFor="weekly_activity_description" className="text-sm font-bold text-slate-200">{t.activityLabel}</label>
              <textarea id="weekly_activity_description" name="weekly_activity_description" value={formData.weekly_activity_description} onChange={handleChange} disabled={saving} placeholder={t.activityPlaceholder} className="w-full min-h-[100px] resize-y rounded-xl border border-dark-border bg-dark-bg p-3 text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" required />
            </div>
          </div>

          {error && <div className="rounded-xl border border-red-500/50 bg-red-900/40 p-3"><p className="text-center text-sm text-red-200">{error}</p></div>}

          <div className="flex justify-end gap-3 mt-4">
            {!isFirstTime && (
              <button type="button" onClick={() => { setIsEditing(false); setError(''); }} disabled={saving} className="rounded-xl border border-dark-border bg-transparent px-5 py-3 font-extrabold text-slate-300 hover:text-slate-100 hover:bg-dark-border transition-colors">
                {t.cancel}
              </button>
            )}
            <button type="submit" disabled={saving} className="rounded-xl bg-brand px-5 py-3 font-extrabold text-dark-bg transition-all duration-300 hover:bg-brand-light hover:shadow-lg hover:shadow-brand/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? t.working : (isFirstTime ? t.saveProfile : t.saveChanges)}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="w-full max-w-2xl mx-auto overflow-hidden rounded-[18px] border border-dark-border bg-dark-surface shadow-[0_18px_50px_rgba(0,0,0,.18)] animate-fade-in-up">
      <div className="border-b border-dark-border bg-[#0c3d31]/80 p-8 flex items-center justify-between">
        <h2 className="text-2xl font-extrabold tracking-tight text-brand-light">{t.profile}</h2>
        <button onClick={() => setIsEditing(true)} className="rounded-xl bg-brand/20 border border-brand/40 px-4 py-2 text-sm font-extrabold text-brand hover:bg-brand/30 transition-colors">
          {t.editProfile}
        </button>
      </div>
      <div className="p-8">
        {success && <div className="mb-6 rounded-xl border border-brand/40 bg-brand/10 p-3"><p className="text-center text-sm text-brand-light">{success}</p></div>}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-4">
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.nameLabel}</span>
            <strong className="text-lg text-slate-100">{profile.name}</strong>
          </div>
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.dobLabel}</span>
            <strong className="text-lg text-slate-100">{profile.date_of_birth} ({calculateAge(profile.date_of_birth)} {t.age})</strong>
          </div>
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.weightLabel}</span>
            <strong className="text-lg text-slate-100">{profile.weight_kg} kg</strong>
          </div>
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.heightLabel}</span>
            <strong className="text-lg text-slate-100">{profile.height_cm} cm</strong>
          </div>
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.sexLabel}</span>
            <strong className="text-lg text-slate-100">
              {profile.sex === 'male' ? t.sexMale : profile.sex === 'female' ? t.sexFemale : t.sexOther}
            </strong>
          </div>
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.goalLabel}</span>
            <strong className="text-lg text-slate-100">
              {profile.goal === 'lose' ? t.goalLose : profile.goal === 'maintain' ? t.goalMaintain : t.goalGain}
            </strong>
          </div>
          <div>
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.dailyGoal}</span>
            <strong className="text-lg text-[#86efc2]">
              {profile.daily_calorie_goal ? `${profile.daily_calorie_goal} kcal` : t.goalPending}
            </strong>
          </div>
          <div className="md:col-span-2">
            <span className="block text-sm text-[#a8bdb6] mb-1">{t.activityLabel}</span>
            <p className="text-base text-slate-100 bg-dark-bg p-4 rounded-xl border border-dark-border">{profile.weekly_activity_description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
