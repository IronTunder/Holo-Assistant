// frontend/my-app/src/api/config.ts

/**
 * API Configuration
 * Centralized configuration for API endpoints and base URL
 */

const getApiBaseUrl = (): string => {
  // Development environment
  if (import.meta.env.DEV) {
    // Use VITE_API_URL from .env.development, fallback to localhost:8000
    return import.meta.env.VITE_API_URL || 'http://localhost:8000';
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
  LOGOUT: `${API_BASE_URL}/auth/logout`,

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
  GET_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  CREATE_ADMIN_MACHINE: `${API_BASE_URL}/admin/machines`,
  UPDATE_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  DELETE_ADMIN_MACHINE: (id: number) => `${API_BASE_URL}/admin/machines/${id}`,
  RESET_MACHINE_STATUS: (id: number) => `${API_BASE_URL}/admin/machines/${id}/reset-status`,

  LIST_LOGS: `${API_BASE_URL}/admin/logs`,
};

export default API_ENDPOINTS;
