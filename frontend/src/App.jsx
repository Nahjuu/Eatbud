import { useState, useContext, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Main from './components/Main';
import Login from './components/Login';
import Profile from './components/Profile';
import { translations } from './translations';
import { AuthProvider, AuthContext } from './context/AuthContext';
import { supabase } from './supabaseClient';

const apiUrl = import.meta.env.VITE_API_URL || '/api';

function AppContent({ lang, setLanguage, t }) {
  const { session, loading: sessionLoading } = useContext(AuthContext);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [currentView, setCurrentView] = useState('home'); // 'home', 'profile'
  const [profileError, setProfileError] = useState('');

  const fetchProfile = async () => {
    if (!session) return;
    setProfileLoading(true);
    setProfileError('');
    try {
      const response = await fetch(`${apiUrl}/profile`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setProfile(data.profile);
    } catch (err) {
      setProfileError(err.message || 'Error al cargar perfil');
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchProfile();
    } else {
      setProfile(null);
      setCurrentView('home');
    }
  }, [session]);

  if (sessionLoading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-50">Cargando sesión...</div>;
  }

  if (!session) {
    return <Login lang={lang} setLanguage={setLanguage} t={t} />;
  }

  if (profileLoading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-50">Cargando perfil...</div>;
  }

  if (profileError && !profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-slate-50">
        <p className="text-red-400">{profileError}</p>
        <button onClick={fetchProfile} className="rounded-xl bg-brand px-4 py-2 font-bold text-dark-bg hover:bg-brand-light">Reintentar</button>
      </div>
    );
  }

  // Profile is required
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Profile 
          session={session} 
          profile={profile} 
          setProfile={setProfile} 
          t={t} 
          isFirstTime={true} 
          onComplete={() => setCurrentView('home')}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar 
        lang={lang} 
        setLanguage={setLanguage} 
        t={t} 
        session={session} 
        supabase={supabase} 
        currentView={currentView}
        setCurrentView={setCurrentView}
        profile={profile}
      />
      <main className="flex-1 overflow-y-auto w-full">
        <div className="mx-auto w-[calc(100%-32px)] max-w-[720px] py-[32px] md:py-[72px]">
          {currentView === 'home' && (
            <>
              <header className="mb-8">
                <p className="mb-3 text-xs font-extrabold tracking-[.18em] text-brand">{t.eyebrow}</p>
                <h1 className="mb-3 max-w-[560px] text-[clamp(2.2rem,7vw,4rem)] font-bold leading-[1.05] tracking-[-.055em]">
                  {t.title}
                </h1>
                <p className="mb-0 max-w-[560px] text-[1.05rem] leading-[1.6] text-[#b9c9c4]">
                  {t.intro}
                </p>
              </header>
              <Main lang={lang} t={t} session={session} profile={profile} setProfile={setProfile} />
            </>
          )}
          {currentView === 'profile' && (
            <Profile 
              session={session} 
              profile={profile} 
              setProfile={setProfile} 
              t={t} 
            />
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  const [lang, setLang] = useState('es');
  const [t, setT] = useState(translations[lang]);

  useEffect(() => {
    setT(translations[lang]);
  }, [lang]);

  return (
    <div className="min-h-screen min-w-80 bg-[#07110f] bg-[radial-gradient(circle_at_top_left,_#174a3d,_transparent_36rem)] font-sans text-[#f8fafc] [font-synthesis:none]">
      <AuthProvider>
        <AppContent lang={lang} setLanguage={setLang} t={t} />
      </AuthProvider>
    </div>
  );
}

export default App;
