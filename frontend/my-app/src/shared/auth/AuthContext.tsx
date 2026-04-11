import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import API_ENDPOINTS from '../api/config';

export interface AuthUser {
  id: number;
  nome: string;
  badge_id: string;
  role_id?: number | null;
  role_name?: string | null;
  role_code?: string | null;
  permissions?: string[];
  livello_esperienza: string;
  department_id?: number | null;
  department_name?: string | null;
  reparto: string;
  turno: string;
  created_at: string;
}

export interface AuthAssignedMachine {
  id: number;
  nome: string;
  department_id?: number | null;
  working_station_id?: number | null;
  department_name?: string | null;
  reparto: string;
  descrizione: string;
  id_postazione: string;
  in_uso: boolean;
  startup_checklist: string[];
}

export interface AuthWorkingStation {
  id: number;
  name: string;
  department_id?: number | null;
  department_name?: string | null;
  reparto: string;
  description?: string | null;
  station_code: string;
  in_uso: boolean;
  startup_checklist: string[];
  assigned_machine?: AuthAssignedMachine | null;
}

export interface AuthContextType {
  isLoggedIn: boolean;
  isAdmin: boolean;
  accessToken: string | null;
  user: AuthUser | null;
  workingStation: AuthWorkingStation | null;
  assignedMachine: AuthAssignedMachine | null;
  machine: AuthAssignedMachine | null;
  chatSessionId: number | null;
  expiresIn: number | null;
  login: (
    accessToken: string,
    user: AuthUser,
    workingStation: AuthWorkingStation,
    assignedMachine: AuthAssignedMachine | null,
    chatSessionId: number | null,
    expiresIn: number
  ) => void;
  adminLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  restoreSession: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  setTokensFromRefresh: (accessToken: string, expiresIn: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workingStation, setWorkingStation] = useState<AuthWorkingStation | null>(null);
  const [assignedMachine, setAssignedMachine] = useState<AuthAssignedMachine | null>(null);
  const [chatSessionId, setChatSessionId] = useState<number | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  const clearSession = useCallback(() => {
    setIsLoggedIn(false);
    setIsAdmin(false);
    setAccessToken(null);
    setUser(null);
    setWorkingStation(null);
    setAssignedMachine(null);
    setChatSessionId(null);
    setExpiresIn(null);

    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    localStorage.removeItem('workingStation');
    localStorage.removeItem('assignedMachine');
    localStorage.removeItem('chatSessionId');
    localStorage.removeItem('expiresIn');
    localStorage.removeItem('loginTimestamp');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('refreshToken');
  }, []);

  const login = useCallback((
    nextAccessToken: string,
    nextUser: AuthUser,
    nextWorkingStation: AuthWorkingStation,
    nextAssignedMachine: AuthAssignedMachine | null,
    nextChatSessionId: number | null,
    nextExpiresIn: number
  ) => {
    setAccessToken(nextAccessToken);
    setUser(nextUser);
    setWorkingStation(nextWorkingStation);
    setAssignedMachine(nextAssignedMachine);
    setChatSessionId(nextChatSessionId);
    setExpiresIn(nextExpiresIn);
    setIsLoggedIn(true);
    setIsAdmin(false);

    localStorage.removeItem('accessToken');
    localStorage.setItem('user', JSON.stringify(nextUser));
    localStorage.setItem('workingStation', JSON.stringify(nextWorkingStation));
    if (nextAssignedMachine) {
      localStorage.setItem('assignedMachine', JSON.stringify(nextAssignedMachine));
    } else {
      localStorage.removeItem('assignedMachine');
    }
    if (nextChatSessionId) {
      localStorage.setItem('chatSessionId', String(nextChatSessionId));
    } else {
      localStorage.removeItem('chatSessionId');
    }
    localStorage.setItem('expiresIn', nextExpiresIn.toString());
    localStorage.setItem('loginTimestamp', Date.now().toString());
    localStorage.setItem('isAdmin', 'false');
    localStorage.removeItem('refreshToken');
  }, []);

  const adminLogin = useCallback(async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(API_ENDPOINTS.ADMIN_LOGIN, {
        method: 'POST',
        credentials: 'include',
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
      setUser(data.user);
      setWorkingStation(null);
      setAssignedMachine(null);
      setChatSessionId(null);
      setExpiresIn(data.expires_in);
      setIsLoggedIn(true);
      setIsAdmin(Boolean(data.is_admin));

      localStorage.removeItem('accessToken');
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.removeItem('workingStation');
      localStorage.removeItem('assignedMachine');
      localStorage.removeItem('chatSessionId');
      localStorage.setItem('expiresIn', data.expires_in.toString());
      localStorage.setItem('loginTimestamp', Date.now().toString());
      localStorage.setItem('isAdmin', data.is_admin ? 'true' : 'false');
      localStorage.removeItem('refreshToken');

      return { success: true };
    } catch (error) {
      console.error('Errore durante admin login:', error);
      return { success: false, error: 'Errore di connessione al server' };
    }
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(API_ENDPOINTS.REFRESH_TOKEN, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        clearSession();
        return null;
      }

      const data = await response.json();
      setAccessToken(data.access_token);
      setExpiresIn(data.expires_in);
      localStorage.removeItem('accessToken');
      localStorage.setItem('expiresIn', data.expires_in.toString());
      localStorage.setItem('loginTimestamp', Date.now().toString());

      return data.access_token;
    } catch (error) {
      console.error('Errore nel refresh token:', error);
      clearSession();
      return null;
    }
  }, [clearSession]);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    const storedUser = localStorage.getItem('user');
    const storedIsAdmin = localStorage.getItem('isAdmin') === 'true';
    const storedWorkingStation = localStorage.getItem('workingStation');
    const storedAssignedMachine = localStorage.getItem('assignedMachine');
    const storedChatSessionId = localStorage.getItem('chatSessionId');

    if (!storedUser) {
      return false;
    }

    try {
      const parsedUser = JSON.parse(storedUser);
      const parsedWorkingStation = storedWorkingStation ? JSON.parse(storedWorkingStation) : null;
      const parsedAssignedMachine = storedAssignedMachine ? JSON.parse(storedAssignedMachine) : null;
      const refreshedAccessToken = await refreshAccessToken();
      if (!refreshedAccessToken) {
        return false;
      }

      let nextUser = parsedUser;
      let nextIsAdmin = storedIsAdmin;
      try {
        const meResponse = await fetch(API_ENDPOINTS.AUTH_ME, {
          headers: { Authorization: `Bearer ${refreshedAccessToken}` },
          credentials: 'include',
        });
        if (meResponse.ok) {
          const sessionData = await meResponse.json();
          nextUser = sessionData.user;
          nextIsAdmin = sessionData.is_admin;
          localStorage.setItem('user', JSON.stringify(nextUser));
          localStorage.setItem('isAdmin', nextIsAdmin ? 'true' : 'false');
        }
      } catch (error) {
        console.error('Errore nel refresh dati utente:', error);
      }

      const refreshedExpiresIn = parseInt(localStorage.getItem('expiresIn') || '0', 10);

      setAccessToken(refreshedAccessToken);
      setUser(nextUser);
      setWorkingStation(parsedWorkingStation);
      setAssignedMachine(parsedAssignedMachine);
      setChatSessionId(storedChatSessionId ? parseInt(storedChatSessionId, 10) : null);
      setExpiresIn(refreshedExpiresIn);
      setIsLoggedIn(true);
      setIsAdmin(nextIsAdmin);
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
    localStorage.removeItem('accessToken');
    localStorage.setItem('expiresIn', newExpiresIn.toString());
    localStorage.setItem('loginTimestamp', Date.now().toString());
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const logoutBody = JSON.stringify({
          working_station_id: workingStation?.id,
        });

        let response = await fetch(API_ENDPOINTS.LOGOUT, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: logoutBody,
        });

        if (response.status === 401) {
          const refreshedToken = await refreshAccessToken();
          if (refreshedToken) {
            response = await fetch(API_ENDPOINTS.LOGOUT, {
              method: 'POST',
              credentials: 'include',
              headers: {
                ...headers,
                Authorization: `Bearer ${refreshedToken}`,
              },
              body: logoutBody,
            });
          }
        }

        if (!response.ok) {
          console.error(`Logout failed with status: ${response.status}`);
        }
      } catch (error) {
        console.error('Errore durante logout:', error);
      }
    }

    clearSession();
  }, [accessToken, clearSession, refreshAccessToken, user, workingStation]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (!['user', 'workingStation', 'assignedMachine', 'chatSessionId', 'isAdmin'].includes(e.key || '')) {
        return;
      }

      if (e.newValue === null && !['workingStation', 'assignedMachine', 'chatSessionId'].includes(e.key || '')) {
        clearSession();
        return;
      }

      const storedUser = localStorage.getItem('user');
      const storedWorkingStation = localStorage.getItem('workingStation');
      const storedAssignedMachine = localStorage.getItem('assignedMachine');
      const storedChatSessionId = localStorage.getItem('chatSessionId');
      const storedIsAdmin = localStorage.getItem('isAdmin') === 'true';
      const storedExpiresIn = parseInt(localStorage.getItem('expiresIn') || '0', 10);

      if (storedUser) {
        setUser(JSON.parse(storedUser));
        setWorkingStation(storedWorkingStation ? JSON.parse(storedWorkingStation) : null);
        setAssignedMachine(storedAssignedMachine ? JSON.parse(storedAssignedMachine) : null);
        setChatSessionId(storedChatSessionId ? parseInt(storedChatSessionId, 10) : null);
        setExpiresIn(storedExpiresIn || null);
        setIsAdmin(storedIsAdmin);
        setIsLoggedIn(true);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [clearSession]);

  const value: AuthContextType = {
    isLoggedIn,
    isAdmin,
    accessToken,
    user,
    workingStation,
    assignedMachine,
    machine: assignedMachine,
    chatSessionId,
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
