// frontend/my-app/src/shared/api/config.ts

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
  INTERACTION_ASK: `${API_BASE_URL}/api/interactions/ask`,
  INTERACTION_QUICK_ACTION: `${API_BASE_URL}/api/interactions/quick-action`,
  INTERACTION_FEEDBACK: (interactionId: number) => `${API_BASE_URL}/api/interactions/${interactionId}/feedback`,
  INTERACTION_RESOLVE: (interactionId: number) => `${API_BASE_URL}/api/interactions/${interactionId}/resolve`,

  // Machines endpoints
  GET_MACHINES: `${API_BASE_URL}/machines`,
  GET_AVAILABLE_MACHINES: `${API_BASE_URL}/machines/available`,
  GET_MACHINE: (id: number) => `${API_BASE_URL}/machines/${id}`,
  CREATE_MACHINE: `${API_BASE_URL}/machines`,
  UPDATE_MACHINE: (id: number) => `${API_BASE_URL}/machines/${id}`,
  DELETE_MACHINE: (id: number) => `${API_BASE_URL}/machines/${id}`,
  UPDATE_MACHINE_STATUS: (id: number) => `${API_BASE_URL}/machines/${id}/status`,

  // Admin endpoints
  ADMIN_DASHBOARD_SUMMARY: `${API_BASE_URL}/admin/dashboard-summary`,
  ADMIN_SETTINGS: `${API_BASE_URL}/admin/settings`,
  ADMIN_METADATA_DEPARTMENTS: `${API_BASE_URL}/admin/metadata/departments`,
  ADMIN_METADATA_CATEGORIES: `${API_BASE_URL}/admin/metadata/categories`,
  ADMIN_METADATA_MACHINES: `${API_BASE_URL}/admin/metadata/machines`,
  ADMIN_METADATA_USERS: `${API_BASE_URL}/admin/metadata/users`,
  ADMIN_METADATA_ROLES: `${API_BASE_URL}/admin/metadata/roles`,

  LIST_USERS: `${API_BASE_URL}/admin/users`,
  GET_USER: (id: number) => `${API_BASE_URL}/admin/users/${id}`,
  CREATE_USER: `${API_BASE_URL}/admin/users`,
  UPDATE_USER: (id: number) => `${API_BASE_URL}/admin/users/${id}`,
  DELETE_USER: (id: number) => `${API_BASE_URL}/admin/users/${id}`,
  RESET_PASSWORD: (id: number) => `${API_BASE_URL}/admin/users/${id}/reset-password`,

  LIST_ROLES: `${API_BASE_URL}/admin/roles`,
  CREATE_ROLE: `${API_BASE_URL}/admin/roles`,
  UPDATE_ROLE: (id: number) => `${API_BASE_URL}/admin/roles/${id}`,
  DELETE_ROLE: (id: number) => `${API_BASE_URL}/admin/roles/${id}`,

  LIST_DEPARTMENTS: `${API_BASE_URL}/admin/departments`,
  CREATE_DEPARTMENT: `${API_BASE_URL}/admin/departments`,
  UPDATE_DEPARTMENT: (id: number) => `${API_BASE_URL}/admin/departments/${id}`,
  DELETE_DEPARTMENT: (id: number) => `${API_BASE_URL}/admin/departments/${id}`,

  LIST_MACHINES: `${API_BASE_URL}/admin/machines`,
  ADMIN_MACHINE_EVENTS: `${API_BASE_URL}/admin/machine-events`,
  GET_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  CREATE_ADMIN_MACHINE: `${API_BASE_URL}/admin/machines`,
  UPDATE_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  DELETE_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  RESET_MACHINE_STATUS: (id: number) => `${API_BASE_URL}/admin/machines/${id}/reset-status`,

  LIST_ADMIN_CATEGORIES: `${API_BASE_URL}/admin/categories`,
  CREATE_ADMIN_CATEGORY: `${API_BASE_URL}/admin/categories`,
  UPDATE_ADMIN_CATEGORY: (id: number) => `${API_BASE_URL}/admin/categories/${id}`,
  LIST_KNOWLEDGE_ITEMS: `${API_BASE_URL}/admin/knowledge-items`,
  CREATE_KNOWLEDGE_ITEM: `${API_BASE_URL}/admin/knowledge-items`,
  UPDATE_KNOWLEDGE_ITEM: (id: number) => `${API_BASE_URL}/admin/knowledge-items/${id}`,
  DELETE_KNOWLEDGE_ITEM: (id: number) => `${API_BASE_URL}/admin/knowledge-items/${id}`,
  LIST_MACHINE_KNOWLEDGE: (machineId: number) => `${API_BASE_URL}/admin/machines/${machineId}/knowledge`,

  LIST_LOGS: `${API_BASE_URL}/admin/logs`,

  TTS_HEALTH: `${API_BASE_URL}/tts/health`,
  TTS_SYNTHESIZE: `${API_BASE_URL}/tts/synthesize`,
};

export default API_ENDPOINTS;
