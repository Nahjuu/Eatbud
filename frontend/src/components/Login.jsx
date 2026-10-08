import { useState } from 'react';
import { supabase } from '../supabaseClient';
import LanguageSelector from './LanguageSelector';

export default function Login({ lang, setLanguage, t }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isRegistration = mode === 'signup';

  const changeMode = () => {
    const nextMode = mode === 'signin' ? 'signup' : 'signin';
    setMode(nextMode);
    if (nextMode === 'signup') setShowResendConfirmation(false);
    setError('');
    setNotice('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (isRegistration && password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }

    setLoading(true);
    const { data, error: authError } = isRegistration
      ? await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        })
      : await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
    } else if (isRegistration) {
      // Supabase deliberately returns a successful response for an email that
      // already exists, but does not send another confirmation message.
      setNotice(data.user?.identities?.length === 0 ? t.accountAlreadyExists : t.confirmationSent);
      setMode('signin');
      setShowResendConfirmation(true);
      setPassword('');
      setConfirmPassword('');
    }

    setLoading(false);
  };

  const resendConfirmation = async () => {
    if (!email) return;

    setError('');
    setNotice('');
    setResending(true);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    if (resendError) {
      setError(resendError.message);
    } else {
      setNotice(t.confirmationResent);
    }
    setResending(false);
  };

  return (
    <main className="relative flex min-h-[80vh] items-center justify-center p-4">
      <div className="absolute left-4 top-4">
        <LanguageSelector lang={lang} setLanguage={setLanguage} />
      </div>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-dark-border bg-dark-surface shadow-2xl backdrop-blur-md animate-fade-in-up">
        <div className="border-b border-dark-border bg-[#0c3d31]/80 p-8 text-center">
          <p className="mb-3 text-lg font-extrabold tracking-[.18em] text-brand">EATBUD</p>
          <h2 className="mb-2 text-3xl font-extrabold tracking-tight text-brand-light">{isRegistration ? t.registerTitle : t.loginTitle}</h2>
          <p className="text-sm text-slate-300">{isRegistration ? t.registerHint : t.loginPasswordHint}</p>
        </div>

        <div className="p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-bold text-slate-200">{t.emailLabel}</label>
              <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" disabled={loading} autoComplete="email" className="w-full rounded-xl border border-dark-border bg-dark-bg p-4 text-slate-100 outline-none transition-all duration-300 focus:border-brand focus:ring-4 focus:ring-brand/20" required />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-bold text-slate-200">{t.passwordLabel}</label>
              <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" disabled={loading} minLength="6" autoComplete={isRegistration ? 'new-password' : 'current-password'} className="w-full rounded-xl border border-dark-border bg-dark-bg p-4 text-slate-100 outline-none transition-all duration-300 focus:border-brand focus:ring-4 focus:ring-brand/20" required />
            </div>

            {isRegistration && (
              <div className="flex flex-col gap-2">
                <label htmlFor="confirm-password" className="text-sm font-bold text-slate-200">{t.confirmPasswordLabel}</label>
                <input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="••••••••" disabled={loading} minLength="6" autoComplete="new-password" className="w-full rounded-xl border border-dark-border bg-dark-bg p-4 text-slate-100 outline-none transition-all duration-300 focus:border-brand focus:ring-4 focus:ring-brand/20" required />
              </div>
            )}

            <button type="submit" disabled={loading || !email || !password || (isRegistration && !confirmPassword)} className="w-full rounded-xl bg-brand px-5 py-3 font-extrabold text-dark-bg transition-all duration-300 hover:bg-brand-light hover:shadow-lg hover:shadow-brand/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-100">
              {loading ? t.working : (isRegistration ? t.createAccount : t.signIn)}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-300">
            {isRegistration ? t.alreadyHaveAccount : t.noAccount}{' '}
            <button type="button" onClick={changeMode} className="cursor-pointer border-0 bg-transparent p-0 font-bold text-brand hover:text-brand-light">
              {isRegistration ? t.signIn : t.createAccount}
            </button>
          </p>

          {notice && <div className="mt-6 rounded-xl border border-brand/40 bg-brand/10 p-4"><p className="text-center text-sm text-brand-light">{notice}</p></div>}
          {error && <div className="mt-6 rounded-xl border border-red-500/50 bg-red-900/40 p-4"><p className="text-center text-sm text-red-200">{error}</p></div>}
          {mode === 'signin' && showResendConfirmation && (
            <button type="button" onClick={resendConfirmation} disabled={resending || !email} className="mt-4 w-full cursor-pointer border-0 bg-transparent p-0 text-center text-sm font-bold text-brand hover:text-brand-light disabled:cursor-not-allowed disabled:opacity-50">
              {resending ? t.working : t.resendConfirmation}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
