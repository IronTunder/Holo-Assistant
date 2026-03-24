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
  expiresIn: number | null; // secondi fino a scadenza
  
  // Azioni
  login: (accessToken: string, refreshToken: string, user: AuthUser, machine: AuthMachine, expiresIn: number) => void;
  adminLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  restoreSession: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
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

  // Funzione di login
  const login = useCallback((
    accessToken: string,
    refreshToken: string,
    user: AuthUser,
    machine: AuthMachine,
    expiresIn: number
  ) => {
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    setUser(user);
    setMachine(machine);
    setExpiresIn(expiresIn);
    setIsLoggedIn(true);
    setIsAdmin(false);

    // Salva in localStorage
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('machine', JSON.stringify(machine));
    localStorage.setItem('expiresIn', expiresIn.toString());
    localStorage.setItem('loginTimestamp', Date.now().toString());
    localStorage.setItem('isAdmin', 'false');
  }, []);

  // Funzione di admin login
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
      setMachine(null); // Admin non ha macchina assegnata
      setExpiresIn(data.expires_in);
      setIsLoggedIn(true);
      setIsAdmin(true);

      // Salva in localStorage
      localStorage.setItem('accessToken', data.access_token);
      localStorage.setItem('refreshToken', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('expiresIn', data.expires_in.toString());
      localStorage.setItem('loginTimestamp', Date.now().toString());
      localStorage.setItem('isAdmin', 'true');

      return { success: true };
    } catch (error) {
      console.error('Errore durante admin login:', error);
      return { success: false, error: 'Errore di connessione al server' };
    }
  }, []);

  // Ripristina sessione da localStorage
  const restoreSession = useCallback(async (): Promise<boolean> => {
    const storedRefreshToken = localStorage.getItem('refreshToken');
    const storedAccessToken = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');
    const storedIsAdmin = localStorage.getItem('isAdmin') === 'true';
    const storedMachine = localStorage.getItem('machine');

    if (!storedRefreshToken || !storedAccessToken || !storedUser) {
      return false;
    }

    try {
      // Prova a ripristinare direttamente dallo storage
      const user = JSON.parse(storedUser);
      const machine = storedMachine ? JSON.parse(storedMachine) : null;
      const expiresIn = parseInt(localStorage.getItem('expiresIn') || '0', 10);
      const loginTimestamp = parseInt(localStorage.getItem('loginTimestamp') || '0', 10);

      // Verifica se il token è ancora valido (con margine di 5 minuti)
      const elapsedSeconds = (Date.now() - loginTimestamp) / 1000;
      const tokenValidSeconds = expiresIn - 300; // 5 minuti di margine

      if (elapsedSeconds < tokenValidSeconds) {
        // Token ancora valido
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
        setUser(user);
        if (machine) {
          setMachine(machine);
        }
        setExpiresIn(expiresIn - Math.floor(elapsedSeconds));
        setIsLoggedIn(true);
        setIsAdmin(storedIsAdmin);
        return true;
      } else {
        // Token scaduto o prossimo a scadere, prova il refresh
        return await refreshAccessToken(storedRefreshToken);
      }
    } catch (error) {
      console.error('Errore nel ripristino della sessione:', error);
      // Clearifica da localStorage se errore
      clearSession();
      return false;
    }
  }, []);

  // Aggiorna il token di accesso usando il refresh token
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
        // Refresh fallito, fai logout
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
  }, [refreshToken]);

  // Aggiorna i token da una risposta di refresh
  const setTokensFromRefresh = useCallback((newAccessToken: string, newExpiresIn: number) => {
    setAccessToken(newAccessToken);
    setExpiresIn(newExpiresIn);
    localStorage.setItem('accessToken', newAccessToken);
    localStorage.setItem('expiresIn', newExpiresIn.toString());
    localStorage.setItem('loginTimestamp', Date.now().toString());
  }, []);

  // Effettua logout e revoca il refresh token
  const logout = useCallback(async () => {
    // Se è un operatore (non admin), libera la macchina
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
      // Per admin, solo revoca il token
      try {
        await fetch(API_ENDPOINTS.LOGOUT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: user?.id,
            machine_id: 1, // Dummy per admin
            refresh_token: refreshToken,
          }),
        });
      } catch (error) {
        console.error('Errore durante admin logout:', error);
      }
    }

    clearSession();
  }, [user, machine, refreshToken, isAdmin]);

  // Pulisce lo stato e localStorage
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

  // Monitora il refresh token nei tab aperti
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'refreshToken') {
        if (e.newValue === null) {
          // Logout in un altro tab
          clearSession();
        } else {
          // Login in un altro tab
          const storedUser = localStorage.getItem('user');
          const storedMachine = localStorage.getItem('machine');
          const storedIsAdmin = localStorage.getItem('isAdmin') === 'true';
          if (storedUser) {
            setRefreshToken(e.newValue);
            setUser(JSON.parse(storedUser));
            if (storedMachine) {
              setMachine(JSON.parse(storedMachine));
            }
            setIsAdmin(storedIsAdmin);
            setIsLoggedIn(true);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [clearSession]);

  // Imposta il timer per il refresh automatico del token
  useEffect(() => {
    if (!isLoggedIn || !expiresIn) {
      return;
    }

    // Refresh 5 minuti prima della scadenza
    const refreshBuffer = 5 * 60; // 5 minuti in secondi
    const timeUntilRefresh = expiresIn - refreshBuffer;

    if (timeUntilRefresh <= 0) {
      // Token quasi scaduto, refresha subito
      refreshAccessToken();
      return;
    }

    const timer = setTimeout(() => {
      refreshAccessToken();
    }, timeUntilRefresh * 1000);

    return () => clearTimeout(timer);
  }, [isLoggedIn, expiresIn, refreshAccessToken]);

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
