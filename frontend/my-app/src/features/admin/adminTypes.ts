export interface DepartmentOption {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  is_active: boolean;
}

export interface AdminUser {
  id: number;
  nome: string;
  badge_id: string;
  ruolo: string;
  livello_esperienza: string;
  department_id?: number | null;
  department_name?: string | null;
  reparto?: string | null;
  turno: string;
  created_at: string;
}

export interface AdminMachineOperator {
  id: number;
  nome: string;
  badge_id: string;
  department_id?: number | null;
  department_name?: string | null;
  reparto?: string | null;
  turno: string;
  livello_esperienza: string;
}

export interface AdminMachine {
  id: number;
  nome: string;
  department_id?: number | null;
  department_name?: string | null;
  reparto?: string | null;
  descrizione?: string | null;
  id_postazione?: string | null;
  in_uso: boolean;
  operatore_attuale_id?: number | null;
  operator?: AdminMachineOperator | null;
  deleted?: boolean;
}

export interface AdminCategory {
  id: number;
  name: string;
  description?: string | null;
}

export interface KnowledgeItem {
  id: number;
  category_id: number;
  category_name?: string | null;
  question_title: string;
  answer_text: string;
  keywords?: string | null;
  example_questions?: string | null;
  is_active: boolean;
  sort_order: number;
  assigned_machine_ids: number[];
  assignment_count: number;
}

export interface DashboardSummary {
  total_users: number;
  total_machines: number;
  machines_in_use: number;
  machines_available: number;
  active_departments: number;
  knowledge_items: number;
  recent_interactions: number;
}

export type InteractionFeedbackStatus = 'resolved' | 'unresolved' | 'not_applicable';
export type InteractionActionType = 'question' | 'maintenance' | 'emergency';
export type InteractionPriority = 'normal' | 'critical';

export interface InteractionLogEntry {
  id: number;
  user_id: number;
  user_name: string;
  machine_id: number;
  machine_name: string;
  department_name?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  knowledge_item_id?: number | null;
  knowledge_item_title?: string | null;
  domanda: string;
  risposta?: string | null;
  feedback_status?: InteractionFeedbackStatus | null;
  feedback_timestamp?: string | null;
  action_type: InteractionActionType;
  priority: InteractionPriority;
  timestamp: string;
}
