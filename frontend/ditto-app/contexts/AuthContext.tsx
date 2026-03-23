// contexts/AuthContext.tsx
"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { User, Machine, LoginResponse } from "@/types";
import { authService } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  machine: Machine | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (badgeId: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [machine, setMachine] = useState<Machine | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Carica i dati dal localStorage all'avvio
  useEffect(() => {
    const loadStoredData = () => {
      const storedUser = localStorage.getItem("user");
      const storedMachine = localStorage.getItem("machine");
      const token = localStorage.getItem("access_token");

      if (token && storedUser && storedMachine) {
        setUser(JSON.parse(storedUser));
        setMachine(JSON.parse(storedMachine));
      }
      setIsLoading(false);
    };

    loadStoredData();
  }, []);

  const login = async (badgeId: string): Promise<LoginResponse> => {
    setIsLoading(true);
    try {
      const response = await authService.badgeLogin(badgeId);

      // Salva nel localStorage
      localStorage.setItem("access_token", response.access_token);
      localStorage.setItem("user", JSON.stringify(response.user));
      localStorage.setItem("machine", JSON.stringify(response.machine));

      setUser(response.user);
      setMachine(response.machine);

      return response;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      // Pulisci localStorage
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      localStorage.removeItem("machine");

      setUser(null);
      setMachine(null);
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        machine,
        isLoading,
        isAuthenticated: !!user && !!machine,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
