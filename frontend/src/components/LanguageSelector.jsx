export default function LanguageSelector({ lang, setLanguage }) {
  return (
    <button
      type="button"
      onClick={() => setLanguage(lang === 'es' ? 'en' : 'es')}
      className="cursor-pointer rounded-lg border border-dark-border bg-dark-surface px-3 py-2 text-sm font-semibold text-brand-light outline-none transition-colors hover:border-brand focus:border-brand focus:ring-2 focus:ring-brand/20"
      aria-label="Cambiar idioma"
    >
      {lang === 'es' ? 'UY Español' : 'US English'}
    </button>
  );
}
