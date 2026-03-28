// frontend/my-app/src/api/config.ts

/**
 * API Configuration
 * Centralized configuration for API endpoints and base URL
 */

const getApiBaseUrl = (): string => {
  // Development environment
  if (import.meta.env.DEV) {
    const configuredUrl = import.meta.env.VITE_API_URL;

    if (!configuredUrl) {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }

    try {
      const parsedUrl = new URL(configuredUrl);

      // In dev we keep the backend port/path from env, but align the hostname
      // with the current page so auth cookies stay on the same host during reloads.
      parsedUrl.hostname = window.location.hostname;
      return parsedUrl.toString().replace(/\/$/, '');
    } catch {
      return configuredUrl;
    }
  }

  // Production environment
  // Use VITE_API_URL from .env.production, fallback to relative path
  return import.meta.env.VITE_API_URL || `${window.location.origin}/api`;
};

export const API_BASE_URL = getApiBaseUrl();

export const API_ENDPOINTS = {
  // Auth endpoints
  BADGE_LOGIN: `${API_BASE_URL}/auth/badge-login`,
  CREDENTIALS_LOGIN: `${API_BASE_URL}/auth/credentials-login`,
  ADMIN_LOGIN: `${API_BASE_URL}/auth/admin-login`,
  REFRESH_TOKEN: `${API_BASE_URL}/auth/refresh`,
  REFRESH_TOKEN_STATUS: `${API_BASE_URL}/auth/refresh-token-status`,
  LOGOUT: `${API_BASE_URL}/auth/logout`,
  AUTH_ME: `${API_BASE_URL}/auth/me`,
  SSE_TOKEN: `${API_BASE_URL}/auth/sse-token`,
  SESSION_EVENTS: (machineId: number, token: string) =>
    `${API_BASE_URL}/auth/session-events?machine_id=${machineId}&token=${encodeURIComponent(token)}`,
  SESSION_STATUS: (machineId: number) => `${API_BASE_URL}/auth/session-status?machine_id=${machineId}`,

  // Machines endpoints
  GET_MACHINES: `${API_BASE_URL}/machines`,
  GET_AVAILABLE_MACHINES: `${API_BASE_URL}/machines/available`,
  GET_MACHINE: (id: number) => `${API_BASE_URL}/machines/${id}`,
  CREATE_MACHINE: `${API_BASE_URL}/machines`,
  UPDATE_MACHINE: (id: number) => `${API_BASE_URL}/machines/${id}`,
  DELETE_MACHINE: (id: number) => `${API_BASE_URL}/machines/${id}`,
  UPDATE_MACHINE_STATUS: (id: number) => `${API_BASE_URL}/machines/${id}/status`,

  // Admin endpoints
  LIST_USERS: `${API_BASE_URL}/admin/users`,
  GET_USER: (id: number) => `${API_BASE_URL}/admin/users/${id}`,
  CREATE_USER: `${API_BASE_URL}/admin/users`,
  UPDATE_USER: (id: number) => `${API_BASE_URL}/admin/users/${id}`,
  DELETE_USER: (id: number) => `${API_BASE_URL}/admin/users/${id}`,
  RESET_PASSWORD: (id: number) => `${API_BASE_URL}/admin/users/${id}/reset-password`,

  LIST_MACHINES: `${API_BASE_URL}/admin/machines`,
  ADMIN_MACHINE_EVENTS: `${API_BASE_URL}/admin/machine-events`,
  GET_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  CREATE_ADMIN_MACHINE: `${API_BASE_URL}/admin/machines`,
  UPDATE_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  DELETE_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  RESET_MACHINE_STATUS: (id: number) => `${API_BASE_URL}/admin/machines/${id}/reset-status`,

  LIST_LOGS: `${API_BASE_URL}/admin/logs`,

  TTS_HEALTH: `${API_BASE_URL}/tts/health`,
  TTS_SYNTHESIZE: `${API_BASE_URL}/tts/synthesize`,
};

export default API_ENDPOINTS;
