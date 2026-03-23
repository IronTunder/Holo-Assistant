// types/index.ts

export interface User {
  id: number;
  nome: string;
  badge_id: string;
  livello_esperienza: "apprendista" | "operaio" | "senior" | "manutentore";
  reparto: string;
  turno: "mattina" | "pomeriggio" | "notte";
}

export interface Machine {
  id: number;
  nome: string;
  reparto: string;
  descrizione: string;
  id_postazione: string;
  stato: "libera" | "occupata";
  operatore_corrente?: User;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
  machine: Machine;
  message?: string;
}

export interface ApiError {
  detail: string;
}
