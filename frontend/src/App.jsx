import { useState, useContext, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Main from './components/Main';
import Login from './components/Login';
import Profile from './components/Profile';
import Summaries from './components/Summaries';
import { translations } from './translations';
import { AuthProvider, AuthContext } from './context/AuthContext';
import { supabase } from './supabaseClient';

function AppContent({ lang, setLanguage, t }) {
  // La sesión y el perfil viven en AuthContext, fuera de esta vista: así el
  // perfil no se pierde ni se vuelve a pedir al navegar entre páginas.
  const {
    session,
    loading: sessionLoading,
    profile,
    setProfile,
    profileLoading,
    profileError,
    refreshProfile,
  } = useContext(AuthContext);
  const [currentView, setCurrentView] = useState('home'); // 'home', 'profile', 'summaries'

  // Al cambiar de usuario volvemos a la vista inicial (evita heredar la vista
  // del usuario anterior).
  useEffect(() => {
    setCurrentView('home');
  }, [session?.user?.id]);

  if (sessionLoading) {
    return <div className="flex min-h-screen items-center justify-center px-4 text-center text-slate-50">Cargando sesión...</div>;
  }

  if (!session) {
    return <Login lang={lang} setLanguage={setLanguage} t={t} />;
  }

  // Sólo mostramos "Cargando perfil..." cuando realmente no hay datos usables
  // todavía. Si el perfil ya está cargado, la navegación no muestra este aviso.
  if (!profile && profileLoading) {
    return <div className="flex min-h-screen items-center justify-center px-4 text-center text-slate-50">Cargando perfil...</div>;
  }

  if (!profile && profileError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center text-slate-50">
        <p className="text-red-400">{profileError}</p>
        <button
          onClick={() => refreshProfile({ force: true })}
          className="rounded-xl bg-brand px-4 py-2 font-bold text-dark-bg hover:bg-brand-light"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // El perfil es obligatorio: si todavía no existe, se completa antes de entrar.
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
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
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
      <main className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-[104px] pt-[24px] md:px-8 md:py-[72px]">
          {currentView === 'home' && (
            <>
              <header className="mb-8">
                <p className="mb-3 text-xs font-extrabold tracking-[.18em] text-brand">{t.eyebrow}</p>
                <h1 className="mb-3 text-[clamp(2rem,7vw,4rem)] font-bold leading-[1.05] tracking-[-.055em]">
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
          {currentView === 'summaries' && (
            <>
              <header className="mb-8">
                <p className="mb-3 text-xs font-extrabold tracking-[.18em] text-brand">{t.eyebrow}</p>
                <h1 className="mb-3 text-[clamp(1.7rem,5vw,2.8rem)] font-bold leading-[1.1] tracking-[-.04em]">
                  {t.summariesTitle}
                </h1>
                <p className="mb-0 max-w-[560px] text-[1.05rem] leading-[1.6] text-[#b9c9c4]">
                  {t.summariesIntro}
                </p>
              </header>
              <Summaries lang={lang} t={t} session={session} />
            </>
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
    <div className="min-h-screen bg-[#07110f] bg-[radial-gradient(circle_at_top_left,_#174a3d,_transparent_36rem)] font-sans text-[#f8fafc] [font-synthesis:none]">
      <AuthProvider>
        <AppContent lang={lang} setLanguage={setLang} t={t} />
      </AuthProvider>
    </div>
  );
}

export default App;
