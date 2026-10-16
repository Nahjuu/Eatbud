import { useRef, useState } from 'react';

// Tipos aceptados por el proveedor de visión del backend.
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Límite del archivo original elegido en el dispositivo.
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
// Lado máximo al que se reduce la foto antes de enviarla: mantiene el peso bajo
// y es más que suficiente para que el modelo reconozca la comida.
const MAX_DIMENSION = 1024;

/**
 * Reduce la imagen elegida en el dispositivo y la devuelve como data URL JPEG.
 * El backend siempre recibe un formato que el modelo de visión acepta.
 */
function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('canvas'));
          return;
        }

        context.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

export default function Chat({
  foodText,
  setFoodText,
  image,
  setImage,
  saving,
  saveFood,
  t
}) {
  const fileInputRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [imageError, setImageError] = useState('');

  const busy = saving || processing;
  const canSend = !busy && (Boolean(foodText.trim()) || Boolean(image));

  const handleFileChange = async (event) => {
    const file = event.target.files && event.target.files[0];
    // Permite volver a elegir la misma foto más adelante.
    event.target.value = '';

    if (!file || busy) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError(t.errorPhotoType);
      return;
    }

    if (file.size > MAX_SOURCE_BYTES) {
      setImageError(t.errorPhotoSize);
      return;
    }

    setImageError('');
    setProcessing(true);

    try {
      setImage(await resizeImageToDataUrl(file));
    } catch {
      setImageError(t.errorPhotoRead);
    } finally {
      setProcessing(false);
    }
  };

  const removeImage = () => {
    setImage('');
    setImageError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <form
      className="grid gap-3 rounded-[18px] border border-dark-border bg-dark-surface p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)] sm:p-[22px]"
      onSubmit={saveFood}
    >
      <label htmlFor="food" className="font-bold">{t.whatDidYouEat}</label>

      <textarea
        id="food"
        value={foodText}
        onChange={(event) => setFoodText(event.target.value)}
        placeholder={t.placeholder}
        maxLength="2000"
        disabled={saving}
        className="min-h-[112px] w-full resize-y rounded-[10px] border border-[#426a5d] bg-dark-bg p-[13px] text-base leading-[1.5] text-[#f8fafc] outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(110,231,183,.16)]"
      />

      {image && (
        <div className="relative overflow-hidden rounded-[12px] border border-dark-border bg-dark-bg">
          <img src={image} alt={t.photoPreview} className="mx-auto max-h-60 w-full object-contain" />
          <button
            type="button"
            onClick={removeImage}
            disabled={saving}
            aria-label={t.removePhoto}
            title={t.removePhoto}
            className="absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-dark-border bg-dark-bg/90 text-slate-100 transition-colors hover:border-red-400 hover:text-red-300 disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      )}

      {imageError && <p className="m-0 text-sm text-red-400" role="alert">{imageError}</p>}

      <div className="flex items-center gap-2">
        {/* Adjuntar foto: sólo en móvil, el escritorio conserva su interfaz. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label={t.attachPhoto}
          title={t.attachPhoto}
          className="flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-[#426a5d] bg-dark-bg text-brand transition-colors hover:border-brand hover:text-brand-light disabled:cursor-not-allowed disabled:opacity-50 md:hidden"
        >
          {processing ? (
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5ZM9.75 12a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Z" />
              <path d="M9.6 3.75a.75.75 0 0 0-.624.333L8.28 5.25H6.75A3 3 0 0 0 3.75 8.25v8.25a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V8.25a3 3 0 0 0-3-3h-1.53l-.696-1.167a.75.75 0 0 0-.624-.333H9.6ZM6.75 6.75h2.25l.696-1.167h4.608l.696 1.167h2.25a1.5 1.5 0 0 1 1.5 1.5v8.25a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5Z" />
            </svg>
          )}
        </button>

        <button
          type="submit"
          disabled={!canSend}
          className="ml-auto rounded-[10px] border-0 bg-brand px-4 py-[11px] font-extrabold text-brand-dark hover:enabled:bg-brand-light disabled:cursor-not-allowed disabled:opacity-[.55]"
        >
          {saving ? t.analyzing : t.saveFood}
        </button>
      </div>
    </form>
  );
}
