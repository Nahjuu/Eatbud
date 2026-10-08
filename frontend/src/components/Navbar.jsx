import LanguageSelector from './LanguageSelector';

export default function Navbar({ lang, setLanguage, t, session, supabase }) {
  return (
    <header className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <LanguageSelector lang={lang} setLanguage={setLanguage} />
        {session && (
          <button 
            type="button" 
            onClick={() => supabase.auth.signOut()} 
            className="cursor-pointer text-sm font-semibold text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-[.55]"
          >
            Cerrar Sesión
          </button>
        )}
      </div>
      <p className="mb-3 text-xs font-extrabold tracking-[.18em] text-brand">{t.eyebrow}</p>
      <h1 className="mb-3 max-w-[560px] text-[clamp(2.2rem,7vw,4rem)] font-bold leading-[1.05] tracking-[-.055em]">
        {t.title}
      </h1>
      <p className="mb-0 max-w-[560px] text-[1.05rem] leading-[1.6] text-[#b9c9c4]">
        {t.intro}
      </p>
    </header>
  );
}
