import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { apiUrl } from '../apiUrl';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // El perfil vive acá (y no dentro de una vista) para que sobreviva a la
  // navegación entre páginas: no se vuelve a pedir al servidor ni se muestra
  // "Cargando perfil..." cada vez que el usuario cambia de pantalla.
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Usuario dueño del perfil ya cargado (o en curso) + secuencia de peticiones.
  // Con refs evitamos que un token renovado (TOKEN_REFRESHED) dispare otra carga.
  const profileOwnerRef = useRef(null);
  const requestSeqRef = useRef(0);

  const userId = session?.user?.id ?? null;
  const accessToken = session?.access_token ?? null;

  const loadProfile = useCallback(async ({ force = false } = {}) => {
    if (!userId || !accessToken) return;
    // Ya tenemos (o estamos pidiendo) el perfil de este usuario: no repetimos la
    // petición, salvo que se pida explícitamente un refresco.
    if (!force && profileOwnerRef.current === userId) return;

    profileOwnerRef.current = userId;
    const seq = ++requestSeqRef.current;

    setProfileLoading(true);
    setProfileError('');

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

      // Liberamos el "dueño" para permitir que el usuario reintente.
      profileOwnerRef.current = null;
      setProfileError(err.message || 'Error al cargar perfil');
    } finally {
      if (seq === requestSeqRef.current) setProfileLoading(false);
    }
  }, [userId, accessToken]);

  useEffect(() => {
    if (!userId) {
      // Sin sesión (logout o sesión expirada): limpiamos el perfil para no
      // exponer datos de otra cuenta.
      profileOwnerRef.current = null;
      requestSeqRef.current += 1;
      setProfile(null);
      setProfileError('');
      setProfileLoading(false);
      return;
    }

    // Sólo cargamos cuando cambia el usuario autenticado, nunca por navegar.
    loadProfile();
  }, [userId, loadProfile]);

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
