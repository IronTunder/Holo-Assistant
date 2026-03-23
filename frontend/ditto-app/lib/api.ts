// lib/api.ts
import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor per aggiungere il token JWT alle richieste autenticate
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Servizio per l'autenticazione
export const authService = {
  // Login con badge RFID
  badgeLogin: async (badgeId: string) => {
    const response = await api.post("/auth/badge-login", { badge_id: badgeId });
    return response.data;
  },

  // Logout
  logout: async () => {
    const response = await api.post("/auth/logout");
    return response.data;
  },
};

// Servizio per i macchinari
export const machineService = {
  getAll: async () => {
    const response = await api.get("/machines");
    return response.data;
  },

  getById: async (id: number) => {
    const response = await api.get(`/machines/${id}`);
    return response.data;
  },
};
