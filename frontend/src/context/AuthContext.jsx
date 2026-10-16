import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { apiUrl } from '../apiUrl';

export const AuthContext = createContext(null);

// Último perfil conocido, guardado en este dispositivo y por usuario. Sirve
// para pintar la app al instante al abrirla (sin pantallas de espera) y luego
// se revalida contra el servidor por detrás. La clave lleva el id del usuario,
// así que la caché de una cuenta nunca se puede mostrar en otra.
const PROFILE_CACHE_PREFIX = 'eatbud:profile:';

function readCachedProfile(userId) {
  if (!userId) return null;

  try {
    const raw = window.localStorage.getItem(`${PROFILE_CACHE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Sin almacenamiento (modo privado, permisos) o JSON inválido: seguimos sin caché.
    return null;
  }
}

function writeCachedProfile(userId, profile) {
  if (!userId) return;

  try {
    if (profile) {
      window.localStorage.setItem(`${PROFILE_CACHE_PREFIX}${userId}`, JSON.stringify(profile));
    } else {
      window.localStorage.removeItem(`${PROFILE_CACHE_PREFIX}${userId}`);
    }
  } catch {
    // Sin caché la app funciona igual, sólo que sin pintado instantáneo.
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // El perfil vive acá (y no dentro de una vista) para que sobreviva a la
  // navegación entre páginas: no se vuelve a pedir al servidor ni aparece una
  // pantalla de espera cada vez que el usuario cambia de pantalla.
  const [profileState, setProfileState] = useState(null);
  // Usuario dueño del perfil que hay en memoria: evita mostrar (o guardar) el
  // perfil de una cuenta bajo otra.
  const [profileUserId, setProfileUserId] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  const userId = session?.user?.id ?? null;
  const accessToken = session?.access_token ?? null;

  const userIdRef = useRef(null);
  // El ref se sincroniza en un efecto, nunca durante el render: así el setter
  // público sabe a quién pertenece el perfil (los eventos y las respuestas del
  // servidor ocurren siempre después de este efecto).
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  // Usuario cuyo perfil ya se pidió (o se está pidiendo) al servidor. Evita que
  // un token renovado (TOKEN_REFRESHED) dispare otra petición.
  const loadedUserIdRef = useRef(null);
  // Secuencia de peticiones: las respuestas viejas se descartan.
  const requestSeqRef = useRef(0);

  // Setter público: lo usan Profile.jsx y Main.jsx al guardar cambios. El perfil
  // queda marcado con su dueño y se copia a la caché del dispositivo.
  const setProfile = useCallback((next) => {
    const owner = userIdRef.current;
    setProfileState(next ?? null);
    setProfileUserId(owner);
    writeCachedProfile(owner, next);
  }, []);

  // El perfil sólo se expone si pertenece al usuario autenticado actual: si en
  // memoria todavía está el de otra cuenta, se devuelve null.
  const profile = userId && profileUserId === userId ? profileState : null;

  // Pintado instantáneo: si este dispositivo ya guardó el perfil de este
  // usuario, se usa desde el primer render. Es una actualización de estado
  // durante el render, así que React la aplica antes de pintar: no hay
  // parpadeo ni pantalla de espera al abrir la app.
  if (userId && profileUserId !== userId) {
    const cached = readCachedProfile(userId);
    if (cached) {
      setProfileState(cached);
      setProfileUserId(userId);
    }
  }

  // Al cerrar sesión (o expirar la sesión) se descarta el perfil en memoria para
  // no exponer datos de otra cuenta. También durante el render, para no
  // encadenar render y efecto que no se vería en pantalla.
  if (!userId && profileUserId !== null) {
    setProfileState(null);
    setProfileUserId(null);
    setProfileError('');
    setProfileLoading(false);
  }

  const loadProfile = useCallback(async ({ force = false, background = false } = {}) => {
    if (!userId || !accessToken) return;
    // Ya tenemos (o estamos pidiendo) el perfil de este usuario: no repetimos la
    // petición, salvo que se pida explícitamente un refresco.
    if (!force && loadedUserIdRef.current === userId) return;

    loadedUserIdRef.current = userId;
    const seq = ++requestSeqRef.current;

    // Sólo bloqueamos la interfaz cuando no hay nada que mostrar. Si el perfil
    // ya está en pantalla, el refresco es silencioso.
    if (!background) {
      setProfileLoading(true);
      setProfileError('');
    }

    try {
      const response = await fetch(`${apiUrl}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      // Si mientras tanto cambió el usuario, descartamos la respuesta para no
      // mostrarle a alguien el perfil de otra cuenta.
      if (seq !== requestSeqRef.current) return;

      setProfile(data.profile);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;

      // Un refresco silencioso que falla no molesta al usuario: se sigue usando
      // el perfil que ya está en pantalla y se reintenta en la próxima apertura.
      if (background) return;

      // Liberamos el "dueño" para permitir que el usuario reintente.
      loadedUserIdRef.current = null;
      setProfileError(err.message || 'Error al cargar perfil');
    } finally {
      if (!background && seq === requestSeqRef.current) setProfileLoading(false);
    }
  }, [userId, accessToken, setProfile]);

  useEffect(() => {
    if (!userId) {
      // Sin sesión: descartamos cualquier petición que hubiera quedado en vuelo.
      loadedUserIdRef.current = null;
      requestSeqRef.current += 1;
      return;
    }

    if (loadedUserIdRef.current === userId) return;

    // Sólo cargamos cuando cambia el usuario autenticado, nunca por navegar. Con
    // el perfil ya disponible (caché o memoria) se refresca por detrás.
    loadProfile({ background: profileUserId === userId && Boolean(profile) });
  }, [userId, profileUserId, profile, loadProfile]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!active) return;
      setSession(initialSession);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        setSession,
        loading,
        profile,
        setProfile,
        profileLoading,
        profileError,
        refreshProfile: loadProfile,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}
