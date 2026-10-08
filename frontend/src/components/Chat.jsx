export default function Chat({
  foodText,
  setFoodText,
  saving,
  saveFood,
  t
}) {
  return (
    <form className="grid gap-3 rounded-[18px] border border-dark-border bg-dark-surface p-[22px] shadow-[0_18px_50px_rgba(0,0,0,.18)]" onSubmit={saveFood}>
      <label htmlFor="food" className="font-bold">{t.whatDidYouEat}</label>
      <textarea
        id="food"
        value={foodText}
        onChange={(event) => setFoodText(event.target.value)}
        placeholder={t.placeholder}
        maxLength="2000"
        disabled={saving}
        className="min-h-[124px] w-full resize-y rounded-[10px] border border-[#426a5d] bg-dark-bg p-[13px] leading-[1.5] text-[#f8fafc] outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(110,231,183,.16)]"
      />
      <button type="submit" disabled={saving || !foodText.trim()} className="justify-self-end rounded-[10px] border-0 bg-brand px-4 py-[11px] font-extrabold text-brand-dark hover:enabled:bg-brand-light disabled:cursor-not-allowed disabled:opacity-[.55]">
        {saving ? t.analyzing : t.saveFood}
      </button>
    </form>
  );
}
