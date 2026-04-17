export interface DepartmentOption {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  is_active: boolean;
}

export interface RoleOption {
  id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  permissions: string[];
  is_system: boolean;
  is_active: boolean;
}

export interface AdminUser {
  id: number;
  nome: string;
  badge_id: string;
  ruolo: string;
  role_id?: number | null;
  role_name?: string | null;
  role_code?: string | null;
  permissions: string[];
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
  working_station_id?: number | null;
  descrizione?: string | null;
  id_postazione?: string | null;
  startup_checklist: string[];
  in_uso: boolean;
  operatore_attuale_id?: number | null;
  operator?: AdminMachineOperator | null;
  deleted?: boolean;
}

export interface AdminWorkingStation {
  id: number;
  name: string;
  department_id?: number | null;
  department_name?: string | null;
  reparto?: string | null;
  description?: string | null;
  station_code: string;
  startup_checklist: string[];
  in_uso: boolean;
  operatore_attuale_id?: number | null;
  operator?: AdminMachineOperator | null;
  assigned_machine?: AdminMachine | null;
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
  assigned_working_station_ids: number[];
  assignment_count: number;
}

export interface DashboardSummary {
  total_users: number;
  total_machines: number;
  total_working_stations: number;
  machines_in_use: number;
  machines_available: number;
  active_departments: number;
  knowledge_items: number;
  total_materials: number;
  low_stock_materials: number;
  out_of_stock_materials: number;
  assigned_materials: number;
  recent_interactions: number;
}

export type MaterialStockStatus = 'ok' | 'low_stock' | 'out_of_stock' | 'inactive';
export type MaterialMovementType = 'load' | 'unload' | 'adjustment';

export interface AdminMaterial {
  id: number;
  name: string;
  sku?: string | null;
  category?: string | null;
  description?: string | null;
  characteristics?: string | null;
  aliases?: string | null;
  unit_of_measure: string;
  current_quantity: number;
  minimum_quantity: number;
  reorder_quantity: number;
  storage_location?: string | null;
  is_stock_tracked: boolean;
  last_stock_update_at?: string | null;
  stock_status: MaterialStockStatus;
  assignment_count: number;
  is_active: boolean;
}

export interface WorkingStationMaterialAssignment {
  id: number;
  working_station_id: number;
  machine_id?: number | null;
  machine_name?: string | null;
  material_id: number;
  material_name?: string | null;
  material_category?: string | null;
  material_characteristics?: string | null;
  material_sku?: string | null;
  material_unit_of_measure?: string | null;
  material_current_quantity?: number | null;
  material_minimum_quantity?: number | null;
  material_stock_status?: MaterialStockStatus | null;
  usage_context?: string | null;
  notes?: string | null;
  display_order: number;
  is_required: boolean;
  is_active: boolean;
}

export interface MaterialStockMovement {
  id: number;
  material_id: number;
  movement_type: MaterialMovementType;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  note?: string | null;
  created_by_user_id: number;
  created_by_user_name?: string | null;
  working_station_id?: number | null;
  working_station_name?: string | null;
  related_ticket_id?: number | null;
  created_at: string;
}

export interface AdminMaterialDetail extends AdminMaterial {
  assignments: WorkingStationMaterialAssignment[];
  recent_movements: MaterialStockMovement[];
}

export interface AdminOperationalTicket {
  id: number;
  workflow_type: string;
  status: string;
  priority: InteractionPriority;
  summary: string;
  details?: string | null;
  user_id: number;
  user_name?: string | null;
  working_station_id?: number | null;
  working_station_name?: string | null;
  machine_id?: number | null;
  machine_name?: string | null;
  material_id?: number | null;
  material_name?: string | null;
  interaction_log_id?: number | null;
  conversation_state_id?: number | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

export type InteractionFeedbackStatus = 'resolved' | 'unresolved' | 'not_applicable';
export type InteractionActionType = 'question' | 'maintenance' | 'emergency' | 'material_shortage';
export type InteractionPriority = 'normal' | 'critical';

export interface InteractionLogEntry {
  id: number;
  user_id: number;
  user_name: string;
  machine_id: number;
  machine_name: string;
  working_station_id?: number | null;
  chat_session_id?: number | null;
  conversation_state_id?: number | null;
  department_name?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  knowledge_item_id?: number | null;
  knowledge_item_title?: string | null;
  domanda: string;
  risposta?: string | null;
  feedback_status?: InteractionFeedbackStatus | null;
  feedback_timestamp?: string | null;
  resolved_by_user_id?: number | null;
  resolved_by_user_name?: string | null;
  resolution_note?: string | null;
  resolution_timestamp?: string | null;
  action_type: InteractionActionType;
  workflow_type?: string | null;
  response_mode?: string | null;
  priority: InteractionPriority;
  timestamp: string;
}
