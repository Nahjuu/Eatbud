# Eatbud

Aplicación simple para registrar comidas en lenguaje natural. El backend envía el texto a Groq, guarda el desglose nutricional en Supabase y devuelve el total del día.

## Estructura

- `frontend/`: interfaz React y Vite.
- `backend/`: API Express, Groq y Supabase.
- `backend/schema.sql`: única tabla necesaria para el proyecto.

## Configuración inicial

1. En Supabase, abre **SQL Editor** y ejecuta [`backend/schema.sql`](backend/schema.sql). El script no borra datos.
2. Copia `backend/.env.example` a `backend/.env` y completa las credenciales de Supabase y Groq. La clave `SUPABASE_SERVICE_ROLE_KEY` debe permanecer únicamente en el backend.
3. Instala las dependencias desde cada proyecto:

   ```bash
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```

4. Inicia frontend y backend juntos:

   ```bash
   npm run dev
   ```

Abre `http://localhost:5173`.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto de la API; por defecto `3000`. |
| `FRONTEND_URL` | Origen permitido por CORS; por defecto `http://localhost:5173`. |
| `SUPABASE_URL` | URL del proyecto de Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privada usada solo por la API. |
| `GROQ_API_KEY` | Clave de Groq. |
| `GROQ_MODEL` | Opcional; por defecto `groq/compound-mini`. |
| `VITE_API_URL` | Opcional, en `frontend/.env`; URL pública de la API al publicar frontend y backend por separado. |

`groq/compound-mini` permite que Groq decida si necesita buscar en la web para resolver productos o preparaciones ambiguas. El modelo devuelve un JSON con alimentos, kcal, proteína, carbohidratos y grasas; la API suma esos datos para formar el reporte diario.

## API

- `GET /api/health`: comprueba conexión con la tabla `daily_logs`.
- `GET /api/daily-summary`: devuelve las comidas y macros del día actual.
- `POST /api/logs`: recibe `{ "foodText": "..." }`, analiza con Groq, guarda y devuelve el nuevo resumen diario.
