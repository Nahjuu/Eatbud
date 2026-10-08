import { Menu, X, Home, User } from 'lucide-react';
import { useState } from 'react';
import LanguageSelector from './LanguageSelector';

export default function Sidebar({ lang, setLanguage, t, session, supabase, currentView, setCurrentView, profile }) {
  const [isOpen, setIsOpen] = useState(false);

  const getInitials = (name) => {
    if (!name) return '?';
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <>
      <div className="md:hidden flex items-center justify-between p-4 bg-dark-bg border-b border-dark-border">
        <span className="font-extrabold tracking-[.18em] text-brand">EATBUD</span>
        <button onClick={() => setIsOpen(!isOpen)} className="text-slate-300">
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-dark-bg border-r border-dark-border transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
        <div className="p-6 flex-shrink-0 flex justify-between items-center">
          <span className="text-xl font-extrabold tracking-[.18em] text-brand">EATBUD</span>
          <div className="md:hidden">
            <button onClick={() => setIsOpen(false)} className="text-slate-400">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-4 py-2">
          <LanguageSelector lang={lang} setLanguage={setLanguage} />
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
          <button
            onClick={() => { setCurrentView('home'); setIsOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${currentView === 'home' ? 'bg-dark-surface border border-brand/20 text-brand-light' : 'text-slate-300 hover:bg-dark-surface'}`}
          >
            <Home size={20} />
            <span className="font-semibold">{t.home || 'Inicio'}</span>
          </button>
        </nav>

        {session && profile && (
          <div className="p-4 border-t border-dark-border">
            <button
              onClick={() => { setCurrentView('profile'); setIsOpen(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${currentView === 'profile' ? 'bg-dark-surface border border-brand/20' : 'hover:bg-dark-surface'}`}
            >
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.name} className="w-10 h-10 rounded-full object-cover border border-dark-border" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center text-brand font-bold">
                  {getInitials(profile.name)}
                </div>
              )}
              <div className="flex-1 text-left truncate">
                <p className="text-sm font-bold text-slate-200 truncate">{profile.name}</p>
                <p className="text-xs text-brand truncate">{t.profile || 'Perfil'}</p>
              </div>
            </button>
            <button 
              type="button" 
              onClick={() => supabase.auth.signOut()} 
              className="mt-3 w-full text-center text-xs font-semibold text-red-400 hover:text-red-300"
            >
              {t.logout || 'Cerrar Sesión'}
            </button>
          </div>
        )}
      </div>

      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
