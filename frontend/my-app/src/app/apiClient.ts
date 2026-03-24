import { useAuth } from './AuthContext';

/**
 * Hook personalizzato per fare richieste API autenticate con auto-refresh del token
 */
export const useApiClient = () => {
  const auth = useAuth();

  const apiCall = async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    // Prepara gli headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // Aggiungi il token di accesso
    if (auth.accessToken) {
      headers['Authorization'] = `Bearer ${auth.accessToken}`;
    }

    // Effettua la richiesta
    let response = await fetch(url, {
      ...options,
      headers,
    });

    // Se ricevi 401 (Unauthorized), prova a refreshare il token
    if (response.status === 401) {
      const refreshed = await auth.refreshAccessToken();
      
      if (refreshed && auth.accessToken) {
        headers['Authorization'] = `Bearer ${auth.accessToken}`;
        // Riprova la richiesta con il nuovo token
        response = await fetch(url, {
          ...options,
          headers,
        });
      } else {
        // Refresh fallito, fai logout
        await auth.logout();
        // Reindirizza a login (questo sarà gestito da Root.tsx)
        window.location.href = '/';
      }
    }

    return response;
  };

  return { apiCall };
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
      });

      if (response.status === 401) {
        // Token scaduto, tenta refresh
        const refreshResponse = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: auth.refreshToken }),
        });

        if (refreshResponse.ok) {
          const newTokenData = await refreshResponse.json();
          auth.setTokensFromRefresh(newTokenData.access_token, newTokenData.expires_in);

          // Riprova la richiesta originale
          headers['Authorization'] = `Bearer ${newTokenData.access_token}`;
          return fetch(url, { method: 'GET', headers });
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
      });

      if (response.status === 401) {
        const refreshResponse = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: auth.refreshToken }),
        });

        if (refreshResponse.ok) {
          const newTokenData = await refreshResponse.json();
          auth.setTokensFromRefresh(newTokenData.access_token, newTokenData.expires_in);

          headers['Authorization'] = `Bearer ${newTokenData.access_token}`;
          return fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
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
