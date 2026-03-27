import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import API_ENDPOINTS from '../api/config';

export interface AuthUser {
  id: number;
  nome: string;
  badge_id: string;
  livello_esperienza: string;
  reparto: string;
  turno: string;
  created_at: string;
}

export interface AuthMachine {
  id: number;
  nome: string;
  reparto: string;
  descrizione: string;
  id_postazione: string;
  in_uso: boolean;
}

export interface AuthContextType {
  isLoggedIn: boolean;
  isAdmin: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  machine: AuthMachine | null;
  expiresIn: number | null;
  login: (accessToken: string, refreshToken: string, user: AuthUser, machine: AuthMachine, expiresIn: number) => void;
  adminLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  restoreSession: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshAccessToken: (refreshTokenValue?: string) => Promise<boolean>;
  setTokensFromRefresh: (accessToken: string, expiresIn: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [machine, setMachine] = useState<AuthMachine | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  const clearSession = useCallback(() => {
    setIsLoggedIn(false);
    setIsAdmin(false);
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setMachine(null);
    setExpiresIn(null);

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('machine');
    localStorage.removeItem('expiresIn');
    localStorage.removeItem('loginTimestamp');
    localStorage.removeItem('isAdmin');
  }, []);

  const login = useCallback((
    nextAccessToken: string,
    nextRefreshToken: string,
    nextUser: AuthUser,
    nextMachine: AuthMachine,
    nextExpiresIn: number
  ) => {
    setAccessToken(nextAccessToken);
    setRefreshToken(nextRefreshToken);
    setUser(nextUser);
    setMachine(nextMachine);
    setExpiresIn(nextExpiresIn);
    setIsLoggedIn(true);
    setIsAdmin(false);

    localStorage.setItem('accessToken', nextAccessToken);
    localStorage.setItem('refreshToken', nextRefreshToken);
    localStorage.setItem('user', JSON.stringify(nextUser));
    localStorage.setItem('machine', JSON.stringify(nextMachine));
    localStorage.setItem('expiresIn', nextExpiresIn.toString());
    localStorage.setItem('loginTimestamp', Date.now().toString());
    localStorage.setItem('isAdmin', 'false');
  }, []);

  const adminLogin = useCallback(async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(API_ENDPOINTS.ADMIN_LOGIN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.detail || 'Credenziali non valide' };
      }

      const data = await response.json();

      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setUser(data.user);
      setMachine(null);
      setExpiresIn(data.expires_in);
      setIsLoggedIn(true);
      setIsAdmin(true);

      localStorage.setItem('accessToken', data.access_token);
      localStorage.setItem('refreshToken', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.removeItem('machine');
      localStorage.setItem('expiresIn', data.expires_in.toString());
      localStorage.setItem('loginTimestamp', Date.now().toString());
      localStorage.setItem('isAdmin', 'true');

      return { success: true };
    } catch (error) {
      console.error('Errore durante admin login:', error);
      return { success: false, error: 'Errore di connessione al server' };
    }
  }, []);

  const refreshAccessToken = useCallback(async (refreshTokenValue?: string): Promise<boolean> => {
    const tokenToUse = refreshTokenValue || refreshToken;

    if (!tokenToUse) {
      return false;
    }

    try {
      const response = await fetch(API_ENDPOINTS.REFRESH_TOKEN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: tokenToUse }),
      });

      if (!response.ok) {
        clearSession();
        return false;
      }

      const data = await response.json();
      setAccessToken(data.access_token);
      setExpiresIn(data.expires_in);
      localStorage.setItem('accessToken', data.access_token);
      localStorage.setItem('expiresIn', data.expires_in.toString());
      localStorage.setItem('loginTimestamp', Date.now().toString());

      return true;
    } catch (error) {
      console.error('Errore nel refresh token:', error);
      clearSession();
      return false;
    }
  }, [clearSession, refreshToken]);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    const storedRefreshToken = localStorage.getItem('refreshToken');
    const storedUser = localStorage.getItem('user');
    const storedIsAdmin = localStorage.getItem('isAdmin') === 'true';
    const storedMachine = localStorage.getItem('machine');

    if (!storedRefreshToken || !storedUser) {
      return false;
    }

    try {
      const parsedUser = JSON.parse(storedUser);
      const parsedMachine = storedMachine ? JSON.parse(storedMachine) : null;
      const refreshed = await refreshAccessToken(storedRefreshToken);
      if (!refreshed) {
        return false;
      }

      const refreshedAccessToken = localStorage.getItem('accessToken');
      const refreshedExpiresIn = parseInt(localStorage.getItem('expiresIn') || '0', 10);
      if (!refreshedAccessToken) {
        clearSession();
        return false;
      }

      setAccessToken(refreshedAccessToken);
      setRefreshToken(storedRefreshToken);
      setUser(parsedUser);
      setMachine(parsedMachine);
      setExpiresIn(refreshedExpiresIn);
      setIsLoggedIn(true);
      setIsAdmin(storedIsAdmin);
      return true;
    } catch (error) {
      console.error('Errore nel ripristino della sessione:', error);
      clearSession();
      return false;
    }
  }, [clearSession, refreshAccessToken]);

  const setTokensFromRefresh = useCallback((newAccessToken: string, newExpiresIn: number) => {
    setAccessToken(newAccessToken);
    setExpiresIn(newExpiresIn);
    localStorage.setItem('accessToken', newAccessToken);
    localStorage.setItem('expiresIn', newExpiresIn.toString());
    localStorage.setItem('loginTimestamp', Date.now().toString());
  }, []);

  const logout = useCallback(async () => {
    if (!isAdmin && user && machine && refreshToken) {
      try {
        await fetch(API_ENDPOINTS.LOGOUT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: user.id,
            machine_id: machine.id,
            refresh_token: refreshToken,
          }),
        });
      } catch (error) {
        console.error('Errore durante logout:', error);
      }
    } else if (isAdmin && refreshToken) {
      try {
        await fetch(API_ENDPOINTS.LOGOUT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: user?.id,
            refresh_token: refreshToken,
          }),
        });
      } catch (error) {
        console.error('Errore durante admin logout:', error);
      }
    }

    clearSession();
  }, [clearSession, isAdmin, machine, refreshToken, user]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'refreshToken') {
        if (e.newValue === null) {
          clearSession();
        } else {
          const storedUser = localStorage.getItem('user');
          const storedMachine = localStorage.getItem('machine');
          const storedIsAdmin = localStorage.getItem('isAdmin') === 'true';
          if (storedUser) {
            setRefreshToken(e.newValue);
            setUser(JSON.parse(storedUser));
            setMachine(storedMachine ? JSON.parse(storedMachine) : null);
            setIsAdmin(storedIsAdmin);
            setIsLoggedIn(true);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [clearSession]);

  const value: AuthContextType = {
    isLoggedIn,
    isAdmin,
    accessToken,
    refreshToken,
    user,
    machine,
    expiresIn,
    login,
    adminLogin,
    restoreSession,
    logout,
    refreshAccessToken,
    setTokensFromRefresh,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve essere usato dentro AuthProvider');
  }
  return context;
};
