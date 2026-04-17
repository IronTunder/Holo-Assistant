import type { InteractionActionType, InteractionLogEntry } from './adminTypes';

const MATERIAL_SHORTAGE_HEURISTIC_WINDOW_MS = 10 * 60 * 1000;

export type CompactInteractionLogEntry = InteractionLogEntry & {
  compactedEntriesCount: number;
  compactedStartedAt?: string | null;
  compactedLatestQuestion?: string | null;
};

type LogGroup = {
  key: string;
  logs: InteractionLogEntry[];
};

function getWorkflowLabel(actionType: InteractionActionType, workflowType?: string | null): string | null {
  if (workflowType === 'material_shortage' || actionType === 'material_shortage') {
    return 'Segnalazione materiale';
  }
  return null;
}

function canMergeByWorkflowMetadata(log: InteractionLogEntry, groupLatestLog: InteractionLogEntry): boolean {
  return Boolean(
    log.workflow_type &&
      log.conversation_state_id &&
      log.workflow_type === groupLatestLog.workflow_type &&
      log.conversation_state_id === groupLatestLog.conversation_state_id
  );
}

function canMergeByMaterialShortageHeuristic(log: InteractionLogEntry, groupLatestLog: InteractionLogEntry): boolean {
  if (log.action_type !== 'material_shortage' || groupLatestLog.action_type !== 'material_shortage') {
    return false;
  }
  if (log.user_id !== groupLatestLog.user_id || log.machine_id !== groupLatestLog.machine_id) {
    return false;
  }
  if ((log.chat_session_id ?? null) !== (groupLatestLog.chat_session_id ?? null)) {
    return false;
  }

  const latestTimestamp = new Date(groupLatestLog.timestamp).getTime();
  const currentTimestamp = new Date(log.timestamp).getTime();
  return Math.abs(latestTimestamp - currentTimestamp) <= MATERIAL_SHORTAGE_HEURISTIC_WINDOW_MS;
}

function shouldMergeLog(log: InteractionLogEntry, groupLatestLog: InteractionLogEntry): boolean {
  return canMergeByWorkflowMetadata(log, groupLatestLog) || canMergeByMaterialShortageHeuristic(log, groupLatestLog);
}

function buildCompactedEntry(group: LogGroup): CompactInteractionLogEntry {
  const latestLog = group.logs[0];
  const oldestLog = group.logs[group.logs.length - 1];
  const latestLogWithFeedback = group.logs.find((log) => Boolean(log.feedback_status));
  const latestLogWithResponse = group.logs.find((log) => Boolean(log.risposta));
  const workflowLabel = getWorkflowLabel(latestLog.action_type, latestLog.workflow_type);

  return {
    ...latestLog,
    category_name: latestLog.category_name || workflowLabel || null,
    domanda: oldestLog.domanda,
    risposta: latestLogWithResponse?.risposta ?? latestLog.risposta,
    feedback_status: latestLogWithFeedback?.feedback_status ?? latestLog.feedback_status,
    feedback_timestamp: latestLogWithFeedback?.feedback_timestamp ?? latestLog.feedback_timestamp,
    resolved_by_user_id: latestLogWithFeedback?.resolved_by_user_id ?? latestLog.resolved_by_user_id,
    resolved_by_user_name: latestLogWithFeedback?.resolved_by_user_name ?? latestLog.resolved_by_user_name,
    resolution_note: latestLogWithFeedback?.resolution_note ?? latestLog.resolution_note,
    resolution_timestamp: latestLogWithFeedback?.resolution_timestamp ?? latestLog.resolution_timestamp,
    compactedEntriesCount: group.logs.length,
    compactedStartedAt: oldestLog.timestamp,
    compactedLatestQuestion: latestLog.domanda !== oldestLog.domanda ? latestLog.domanda : null,
  };
}

export function compactInteractionLogs(logs: InteractionLogEntry[]): CompactInteractionLogEntry[] {
  const groups: LogGroup[] = [];

  for (const log of logs) {
    const matchingGroup = groups.find((group) => shouldMergeLog(log, group.logs[0]));
    if (matchingGroup) {
      matchingGroup.logs.push(log);
      continue;
    }

    groups.push({
      key: `${log.id}`,
      logs: [log],
    });
  }

  return groups.map(buildCompactedEntry);
}
