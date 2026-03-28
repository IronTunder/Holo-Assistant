import { useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';

/**
 * Hook personalizzato per fare richieste API autenticate con auto-refresh del token
 */
export const useApiClient = () => {
  const { accessToken, refreshAccessToken, logout } = useAuth();

  const apiCall = useCallback(async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    // Prepara gli headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // Aggiungi il token di accesso
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Effettua la richiesta
    let response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    // Se ricevi 401 (Unauthorized), prova a refreshare il token
    if (response.status === 401) {
      const refreshedToken = await refreshAccessToken();
      
      if (refreshedToken) {
        headers['Authorization'] = `Bearer ${refreshedToken}`;
        // Riprova la richiesta con il nuovo token
        response = await fetch(url, {
          ...options,
          headers,
          credentials: 'include',
        });
      } else {
        // Refresh fallito, fai logout
        await logout();
        // Reindirizza a login (questo sarà gestito da Root.tsx)
        window.location.href = '/';
      }
    }

    return response;
  }, [accessToken, logout, refreshAccessToken]);

  return useMemo(() => ({ apiCall }), [apiCall]);
};

export const createApiClient = (auth: any) => {
  return {
    get: async (url: string) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (auth.accessToken) {
        headers['Authorization'] = `Bearer ${auth.accessToken}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (response.status === 401) {
        // Token scaduto, tenta refresh
        const refreshResponse = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (refreshResponse.ok) {
          const newTokenData = await refreshResponse.json();
          auth.setTokensFromRefresh(newTokenData.access_token, newTokenData.expires_in);

          // Riprova la richiesta originale
          headers['Authorization'] = `Bearer ${newTokenData.access_token}`;
          return fetch(url, { method: 'GET', headers, credentials: 'include' });
        } else {
          // Refresh fallito, logout
          await auth.logout();
          throw new Error('Session expired');
        }
      }

      return response;
    },

    post: async (url: string, body: any) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (auth.accessToken) {
        headers['Authorization'] = `Bearer ${auth.accessToken}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: 'include',
      });

      if (response.status === 401) {
        const refreshResponse = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (refreshResponse.ok) {
          const newTokenData = await refreshResponse.json();
          auth.setTokensFromRefresh(newTokenData.access_token, newTokenData.expires_in);

          headers['Authorization'] = `Bearer ${newTokenData.access_token}`;
          return fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            credentials: 'include',
          });
        } else {
          await auth.logout();
          throw new Error('Session expired');
        }
      }

      return response;
    },
  };
};
