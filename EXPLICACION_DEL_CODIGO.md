# 📖 Eatbud - Explicación Completa de la Arquitectura y Código

Este documento describe **en detalle, carpeta por carpeta, archivo por archivo y componente por componente** la estructura, propósito, flujo de datos y funcionamiento de la aplicación **Eatbud**.

---

## 📌 1. Visión General del Proyecto

**Eatbud** es una aplicación web full-stack para el registro y seguimiento nutricional diario asistido por Inteligencia Artificial.

### ¿Cómo funciona a nivel general?
1. **Autenticación:** El usuario crea una cuenta o inicia sesión utilizando **Supabase Auth** (con confirmación por correo y sesiones basadas en JWT).
2. **Frontend:** Una Single Page Application (SPA) desarrollada con **React + Vite** y estilizada con **Tailwind CSS**. Permite al usuario:
   - Cambiar entre Español e Inglés.
   - Ver el total de calorías y macronutrientes (proteínas, carbohidratos, grasas) acumulados hoy.
   - Enviar una descripción en lenguaje natural de lo que comió (ej.: *"200 g de pechuga de pollo, 1 taza de arroz blanco y una manzana"*).
   - Ver el historial detallado de comidas registradas durante el día.
3. **Backend:** Un servidor API en **Node.js con Express** que:
   - Valida el token del usuario emitido por Supabase.
   - Utiliza la API de **Groq (LLM)** para interpretar el texto del usuario y convertirlo en datos numéricos estructurados (ingredientes, cantidades, unidades, calorías y macronutrientes).
   - Guarda el registro asociado al ID del usuario en una base de datos PostgreSQL en **Supabase**.
   - Calcula y retorna el resumen diario consolidado.

---

## 🗂️ 2. Estructura de Directorios

```text
eatbud con login - copia/
├── package.json                 # Configuración raíz y scripts globales
├── backend/                     # API REST en Node.js + Express
│   ├── .env                     # Variables de entorno secretas (Groq, Supabase)
│   ├── .env.example             # Plantilla de variables para backend
│   ├── package.json             # Dependencias del servidor (Express, Groq, Supabase, etc.)
│   ├── schema.sql               # Script SQL de creación/migración de tablas en Supabase
│   └── server.js                # Servidor principal, endpoints, IA y lógica de base de datos
└── frontend/                    # Cliente web en React + Vite + Tailwind CSS
    ├── index.html               # Plantilla HTML base
    ├── vite.config.js           # Configuración de empaquetado y servidor Vite
    ├── tailwind.config.js       # Configuración del sistema de diseño (colores, sombras, etc.)
    ├── postcss.config.js        # Plugins de procesamiento CSS (Tailwind y Autoprefixer)
    ├── package.json             # Dependencias del cliente (React, Lucide, Tailwind, Supabase)
    └── src/                     # Código fuente de React
        ├── main.jsx             # Punto de entrada JavaScript / montaje del DOM
        ├── App.jsx              # Componente raíz con control de sesión
        ├── index.css            # Directivas Tailwind CSS
        ├── supabaseClient.js    # Inicializador del cliente Supabase del frontend
        ├── translations.js      # Diccionario de idiomas (Español / Inglés)
        ├── context/
        │   └── AuthContext.jsx  # Proveedor global del estado de autenticación
        └── components/
            ├── Navbar.jsx       # Barra superior (logo, cambio de idioma, cerrar sesión)
            ├── Login.jsx        # Pantalla de Login y Registro
            ├── Main.jsx         # Vista principal luego de loguearse (orquestador)
            ├── CalorieCounter.jsx # Tarjeta resumen con total de calorías y macros
            ├── Chat.jsx         # Formulario/caja de texto para ingresar comidas
            ├── LanguageSelector.jsx # Botón conmutador de idioma
            ├── Profile.jsx      # Placeholder para futuras funciones de perfil
            ├── Register.jsx     # Placeholder
            └── Summaries.jsx    # Placeholder
```

---

## ⚙️ 3. Raíz del Proyecto

### [`package.json`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/package.json)
Permite coordinar tanto el frontend como el backend de forma simultánea con una sola consola.
- **Scripts principales:**
  - `npm run dev`: Utiliza la librería `concurrently` para levantar en paralelo `npm run dev --prefix backend` y `npm run dev --prefix frontend`.
  - `npm run dev:backend`: Ejecuta solo el servidor backend.
  - `npm run dev:frontend`: Ejecuta solo el entorno de desarrollo Vite del frontend.
  - `npm run build`: Compila el frontend para producción.

---

## 🖥️ 4. Carpeta `backend/`

El backend es una API REST minimalista, segura y rápida.

### 1. [`backend/package.json`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/backend/package.json)
Declara las dependencias del servidor:
- `express`: Framework para manejar rutas HTTP y middleware.
- `cors`: Permite solicitudes cruzadas desde el frontend (`http://localhost:5173`).
- `dotenv`: Carga variables desde `.env`.
- `@supabase/supabase-js`: Cliente oficial de Supabase con permisos de servicio (`service role`).
- `groq-sdk`: Cliente oficial para consultar modelos de lenguaje ultrarrápidos en Groq.

### 2. [`backend/schema.sql`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/backend/schema.sql)
Define la estructura de la base de datos PostgreSQL en Supabase:
- **Extensión `pgcrypto`**: Para generar UUIDs aleatorios.
- **Tabla `public.daily_logs`**:
  - `id` (UUID): Identificador único de cada comida.
  - `user_id` (TEXT): ID único del usuario de Supabase Auth.
  - `food_text` (TEXT): El texto original ingresado por el usuario.
  - `parsed_data` (JSONB): Estructura generada por la IA que contiene la lista de alimentos desglosados y los subtotales calculados.
  - `logged_at` (TIMESTAMPTZ): Fecha y hora exacta de registro (por defecto `now()`).
- **Índice `daily_logs_user_logged_at_idx`**: Optimiza las consultas que filtran por `user_id` y ordenan cronológicamente.

### 3. [`backend/server.js`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/backend/server.js)
Es el núcleo de toda la lógica de backend:

- **Verificación de Entorno:** Valida que existan `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `GROQ_API_KEY`. Si falta alguna, el proceso se interrumpe con un mensaje claro.
- **Autenticación (`getUserFromReq`):**
  - Lee el encabezado `Authorization: Bearer <token>` de cada petición entrante.
  - Invoca `supabase.auth.getUser(token)` para validar criptográficamente la sesión del usuario. Si el token no es válido o expiró, rechaza la solicitud arrojando un error `Unauthorized` (código HTTP 401).
- **Rango de Fechas (`dateRange`):**
  - Convierte una fecha dada (o la actual) al intervalo UTC `[00:00:00, 24:00:00)` para filtrar correctamente los registros del día.
- **Análisis con IA (`analyzeFood` y `parseAnalysis`):**
  - Envía la descripción del usuario al modelo de Groq (`groq/compound-mini` u otro configurado en `.env`).
  - Utiliza un prompt estricto indicando que responda **únicamente JSON** con la estructura:
    ```json
    {
      "foods": [
        {
          "name": "Pollo",
          "quantity": 200,
          "unit": "g",
          "calories": 330,
          "protein": 62,
          "carbs": 0,
          "fat": 7
        }
      ]
    }
    ```
  - `parseAnalysis` extrae el objeto JSON, normaliza y redondea valores numéricos no negativos y calcula los totales agregados.
- **Consulta de Registros (`getDailySummary`):**
  - Busca en Supabase todos los registros del usuario en el rango del día.
  - Suma todos los macronutrientes y calorías del día para devolver un resumen consolidado con su lista de comidas.
- **Rutas / Endpoints:**
  - `GET /api/health`: Comprueba la conexión a Supabase y la salud de la API.
  - `GET /api/daily-summary?date=YYYY-MM-DD`: Requiere autenticación. Devuelve las comidas y sumatorias del día.
  - `POST /api/logs`: Requiere autenticación y `{ foodText }`. Analiza el texto con Groq, guarda en `daily_logs` y devuelve el nuevo registro junto al resumen actualizado del día.

---

## 🎨 5. Carpeta `frontend/`

El frontend es una interfaz moderna construida con React, con diseño oscuro y toques esmeralda/turquesa (`#07110f`, `#174a3d`, `#86efc2`).

### 1. Archivos de Configuración
- [`frontend/vite.config.js`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/vite.config.js): Define el puerto local (`5173`) y el proxy de desarrollo para redirigir peticiones `/api` al backend (`http://localhost:3000`).
- [`frontend/tailwind.config.js`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/tailwind.config.js): Define la paleta de colores personalizada:
  - `brand`: `#6ee7b7` (verde menta/esmeralda claro)
  - `brand-dark`: `#064e3b`
  - `dark-bg`: `#0a1a17`
  - `dark-surface`: `#102824`
  - `dark-border`: `#1d3e37`
  - Animación `fade-in-up` para transiciones suaves de entrada.
- [`frontend/index.html`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/index.html): HTML principal que define el viewport y monta el `<div id="root">`.

---

## ⚛️ 6. Código Fuente Frontend (`frontend/src/`)

### 1. [`frontend/src/supabaseClient.js`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/supabaseClient.js)
Inicializa y exporta la instancia del cliente Supabase en el navegador utilizando las variables públicas de Vite:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 2. [`frontend/src/translations.js`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/translations.js)
Contiene las etiquetas y mensajes de texto en dos idiomas:
- `es` (Español)
- `en` (Inglés)

Permite internacionalizar títulos, botones, alertas de error, etiquetas de formularios y nombres de macronutrientes.

### 3. [`frontend/src/context/AuthContext.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/context/AuthContext.jsx)
Maneja el estado global de autenticación en la aplicación mediante React Context:
- **`session`**: Almacena el objeto de sesión activo (incluyendo el token JWT y los datos del usuario).
- **`loading`**: Booleano que indica si Supabase está recuperando la sesión guardada en LocalStorage.
- **`onAuthStateChange`**: Listener en tiempo real que actualiza el estado si el usuario inicia sesión, cierra sesión o renueva su token.

### 4. [`frontend/src/App.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/App.jsx)
Componente raíz de la aplicación:
- Maneja el estado del idioma activo (`lang`, por defecto `'es'`).
- Envuelve la aplicación en `<AuthProvider>`.
- Evalúa el estado de autenticación (`session`):
  - Si aún está cargando: Muestra `"Cargando..."`.
  - Si no hay sesión: Muestra la pantalla de [`Login.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Login.jsx).
  - Si hay sesión: Renderiza [`Navbar.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Navbar.jsx) y [`Main.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Main.jsx).

---

## 🧩 7. Componentes de la Interfaz (`frontend/src/components/`)

### 1. [`Login.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Login.jsx)
Controla el flujo de acceso y registro de usuarios:
- **Modos:** Alterna entre `'signin'` (Iniciar Sesión) y `'signup'` (Crear Cuenta).
- **Validaciones:** Comprueba coincidencia de contraseñas y longitud mínima.
- **Interacción con Supabase:**
  - `supabase.auth.signUp(...)`: Registra al nuevo usuario y solicita verificación por email.
  - `supabase.auth.signInWithPassword(...)`: Valida credenciales e inicia sesión.
  - `supabase.auth.resend(...)`: Permite reenviar el correo de confirmación si el usuario no lo recibió.
- Incorpora el botón para cambiar de idioma en la esquina superior izquierda.

### 2. [`Navbar.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Navbar.jsx)
Encabezado de la aplicación cuando el usuario está autenticado:
- Contiene el selector de idioma [`LanguageSelector.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/LanguageSelector.jsx).
- Muestra el botón **"Cerrar Sesión"**, que invoca `supabase.auth.signOut()`.
- Presenta el título principal de la marca (*"Tu alimentación, clara y simple."*).

### 3. [`CalorieCounter.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/CalorieCounter.jsx)
Panel de estadísticas del día:
- **Bloque izquierdo:** Destaca en grande las calorías totales consumidas hoy (`kcal`).
- **Bloque derecho:** Muestra tres columnas con los gramos totales de:
  - Proteína
  - Carbohidratos
  - Grasas

### 4. [`Chat.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Chat.jsx)
Formulario de entrada de comidas:
- Consta de un área de texto (`<textarea>`) donde el usuario redacta libremente lo que comió.
- Botón de envío que cambia a estado de carga (*"Analizando y guardando..."*) mientras la IA de Groq procesa los ingredientes.

### 5. [`Main.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Main.jsx)
Es el orquestador principal de la vista de usuario:
- Conecta los componentes [`CalorieCounter`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/CalorieCounter.jsx) y [`Chat`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Chat.jsx).
- Realiza peticiones al backend adjuntando el token Bearer (`session.access_token`):
  - `GET /api/daily-summary`: Se ejecuta al inicio para traer el registro del día.
  - `POST /api/logs`: Envía el texto escrito y recibe el registro analizado y el nuevo resumen.
- Renderiza la lista cronológica del día (**"Registro de hoy"**):
  - Hora de consumo.
  - Calorías calculadas de la comida.
  - Desglose por ingrediente con su porción y macros (P · C · G).
  - Botón de refresco manual.

### 6. [`LanguageSelector.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/LanguageSelector.jsx)
Botón interactivo accesible que alterna dinámicamente entre `UY Español` y `US English`.

### 7. Componentes Auxiliares
- [`Profile.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Profile.jsx), [`Register.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Register.jsx), [`Summaries.jsx`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/frontend/src/components/Summaries.jsx): Módulos preparados para expansión de características futuras (historiales por fecha, metas nutricionales y perfil de usuario).

---

## 🔄 8. Flujo de Datos Paso a Paso (Ciclo de Vida de un Registro)

```text
[ Usuario ] Escribe: "2 huevos revueltos y una tostada" en Chat.jsx
     │
     ▼
[ Main.jsx ] Envía POST /api/logs con Bearer Token (Supabase JWT)
     │
     ▼
[ server.js ] 1. getUserFromReq() valida el token con Supabase Auth
              2. Envía el texto a Groq con prompt JSON estructurado
              3. Groq responde: { foods: [{ name: "Huevo revuelto", quantity: 2, ... }, ...] }
              4. parseAnalysis() redondea valores y calcula subtotales
              5. Inserta la fila en la tabla daily_logs (Supabase PostgreSQL)
              6. Recalcula los totales del día
              7. Responde HTTP 201 con el log y el nuevo summary
     │
     ▼
[ Main.jsx ] Recibe los datos y actualiza el estado local
     │
     ├──► CalorieCounter.jsx se actualiza con los nuevos totales
     └──► La lista de comidas muestra la nueva tarjeta con hora e ingredientes
```

---

## 🚀 9. Cómo Poner en Marcha la Aplicación

1. **Variables de entorno:**
   - Asegurarse de tener configurados los archivos `.env` tanto en `backend/` como en `frontend/` con las credenciales de Supabase y la clave de Groq.
2. **Base de Datos:**
   - Ejecutar el contenido de [`backend/schema.sql`](file:///c:/Users/USUARIO/Desktop/eatbud%20con%20login%20-%20copia/backend/schema.sql) en el SQL Editor de Supabase.
3. **Ejecución:**
   ```bash
   npm run dev
   ```
   Esto levantará el backend en `http://localhost:3000` y el frontend en `http://localhost:5173`.
