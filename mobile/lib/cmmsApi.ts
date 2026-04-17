import type { ClientAction } from '@sombra/shared';
import { cmmsPaths } from '@sombra/shared';

import { ApiError, fetchWithAuth } from './api';
import { apiBaseUrl } from './config';
import { clearSession, getToken } from './sessionStorage';
import type {
  AssetRow,
  NotificationRow,
  WorkInstructionDto,
  WorkOrderDetail,
  WorkOrderRow,
} from './cmmsTypes';

async function authJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(path, init);
  const body = await res.json().catch(() => null);
  if (res.status === 401) {
    await clearSession();
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  if (!res.ok) {
    const msg =
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export async function getAppParameters(): Promise<{
  wo: {
    start_requires_assignment?: boolean;
    user_auto_assign_on_start?: boolean;
  };
  general?: { idle_session_timeout_minutes?: number };
}> {
  return authJson(cmmsPaths.appParameters, { method: 'GET' });
}

export async function listWorkOrders(): Promise<{ work_orders: WorkOrderRow[] }> {
  return authJson(cmmsPaths.workOrders, { method: 'GET' });
}

export async function listWorkOrderSubscriptions(): Promise<{
  work_order_ids: string[];
}> {
  return authJson(cmmsPaths.workOrderSubscriptions, { method: 'GET' });
}

export type WorkOrderSubscriptionsBulkAction = 'subscribe' | 'unsubscribe';

export async function postWorkOrderSubscriptionsBulk(
  action: WorkOrderSubscriptionsBulkAction,
  work_order_ids: string[],
): Promise<{
  ok: boolean;
  action: WorkOrderSubscriptionsBulkAction;
  changed_count: number;
  requested_count: number;
}> {
  return authJson(cmmsPaths.workOrderSubscriptionsBulk, {
    method: 'POST',
    body: JSON.stringify({ action, work_order_ids }),
  });
}

export async function getWorkOrder(
  id: string,
): Promise<{ work_order: WorkOrderDetail }> {
  return authJson(cmmsPaths.workOrder(id), { method: 'GET' });
}

export async function patchWorkOrderWorkInstruction(
  workOrderId: string,
  workInstructionId: string,
  body: { done: boolean },
): Promise<{ work_instruction: WorkInstructionDto }> {
  return authJson(
    cmmsPaths.workOrderWorkInstruction(workOrderId, workInstructionId),
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
}

export type WorkOrderAssignedEmployeeDto = {
  employee_id: string;
  employee_key: string;
  employee_name: string;
};

export async function listWorkOrderAssignedEmployees(workOrderId: string): Promise<{
  employees: WorkOrderAssignedEmployeeDto[];
}> {
  return authJson(cmmsPaths.workOrderEmployees(workOrderId), { method: 'GET' });
}

export async function postWorkOrderStart(
  id: string,
): Promise<{ work_order: WorkOrderDetail }> {
  return authJson(cmmsPaths.workOrderStart(id), {
    method: 'POST',
    body: '{}',
  });
}

export async function postWorkOrderHold(
  id: string,
  reason: string,
): Promise<{ work_order: WorkOrderDetail }> {
  return authJson(cmmsPaths.workOrderHold(id), {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export type FeedbackEntryPayload = {
  employee_id: string;
  feedback_text: string;
  hours: number;
};

export async function postWorkOrderFeedback(
  id: string,
  payload: {
    entries: FeedbackEntryPayload[];
    target_status?: 'on_hold' | 'done' | null;
    hold_reason?: string | null;
  },
): Promise<{ work_order: WorkOrderDetail }> {
  return authJson(cmmsPaths.workOrderFeedback(id), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listAssets(): Promise<{ assets: AssetRow[] }> {
  return authJson(cmmsPaths.assets, { method: 'GET' });
}

export async function getAsset(id: string): Promise<{ asset: AssetRow }> {
  return authJson(cmmsPaths.asset(id), { method: 'GET' });
}

export async function listNotifications(hours?: number): Promise<{
  notifications: NotificationRow[];
  hours: number;
}> {
  const q = hours != null ? `?hours=${encodeURIComponent(String(hours))}` : '';
  return authJson(`${cmmsPaths.notifications}${q}`, { method: 'GET' });
}

export async function getNotificationsUnreadCount(): Promise<{
  unread_count: number;
}> {
  return authJson(cmmsPaths.notificationsUnreadCount, { method: 'GET' });
}

export async function markNotificationsRead(
  notification_ids: string[],
): Promise<{ ok: boolean; updated_count: number }> {
  return authJson(cmmsPaths.notificationsMarkRead, {
    method: 'POST',
    body: JSON.stringify({ notification_ids }),
  });
}

export type AiRefPayload = { id: string; key?: string; name?: string };

export type AiSuggestWoValidated = {
  short_text: string | null;
  instruction_text: string | null;
  asset_id: string | null;
  work_type_id: string | null;
  workgroup_id: string | null;
  category_id: string | null;
  planned_duration: number | null;
  plan_start: string | null;
};

export type AiSuggestAssetValidated = {
  key: string | null;
  name: string | null;
  asset_type: 'location' | 'building' | 'group' | 'maintenance_object' | null;
  parent_asset_id: string | null;
  costcenter_id: string | null;
  asset_classification_id: string | null;
  equipment_number: string | null;
  serial_no: string | null;
  build_year: number | null;
  warranty_end: string | null;
  priority: number | null;
};

export type AiSuggestResponse =
  | {
      kind: 'work_order';
      transcript_echo: string;
      draft: AiSuggestWoValidated;
      validated: AiSuggestWoValidated;
      unresolved: string[];
      candidates: Record<string, { id: string; label: string; score: number }[]>;
      warnings: string[];
    }
  | {
      kind: 'asset';
      transcript_echo: string;
      draft: AiSuggestAssetValidated;
      validated: AiSuggestAssetValidated;
      unresolved: string[];
      candidates: Record<string, { id: string; label: string; score: number }[]>;
      warnings: string[];
    };

export async function postAiSuggest(body: {
  kind: 'work_order' | 'asset';
  transcript: string;
  context: Record<string, AiRefPayload[]>;
}): Promise<AiSuggestResponse> {
  return authJson(cmmsPaths.aiSuggest, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type CopilotTurnResult = {
  message: { role: 'assistant'; content: string };
  confirmable: Array<
    | { id: string; type: 'create_work_order'; payload: Record<string, unknown> }
    | { id: string; type: 'create_work_plan'; payload: Record<string, unknown> }
    | { id: string; type: 'create_asset'; payload: Record<string, unknown> }
  >;
  client_actions?: ClientAction[];
};

export async function postAiCopilotTurn(body: {
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<CopilotTurnResult> {
  return authJson(cmmsPaths.aiCopilotTurn, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postAiTranscribe(
  audioUri: string,
  options?: { language?: 'de' | 'en' },
): Promise<{ transcript: string }> {
  const token = await getToken();
  const form = new FormData();
  form.append('audio', {
    uri: audioUri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  if (options?.language === 'de' || options?.language === 'en') {
    form.append('language', options.language);
  }

  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`${apiBaseUrl}${cmmsPaths.aiTranscribe}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401) {
      await clearSession();
      const msg =
        typeof (body as { error?: string })?.error === 'string'
          ? (body as { error: string }).error
          : `HTTP ${res.status}`;
      throw new ApiError(msg, res.status, body);
    }
    if (!res.ok) {
      const msg =
        typeof (body as { error?: string })?.error === 'string'
          ? (body as { error: string }).error
          : `HTTP ${res.status}`;
      throw new ApiError(msg, res.status, body);
    }
    return body as { transcript: string };
  } finally {
    clearTimeout(id);
  }
}

export async function listWorkTypes(): Promise<{
  work_types: { id: string; site_id: string; key: string; name: string }[];
}> {
  return authJson('/api/work-types', { method: 'GET' });
}

export async function listWorkgroups(): Promise<{
  workgroups: { id: string; site_id: string; key: string; name: string }[];
}> {
  return authJson('/api/workgroups', { method: 'GET' });
}

export async function listCategories(): Promise<{
  categories: { id: string; site_id: string; key: string; name: string }[];
}> {
  return authJson('/api/categories', { method: 'GET' });
}

export async function listCostcenters(): Promise<{
  costcenters: { id: string; site_id: string; key: string; name: string }[];
}> {
  return authJson('/api/costcenters', { method: 'GET' });
}

export async function listAssetClassifications(): Promise<{
  asset_classifications: { id: string; site_id: string; key: string; name: string }[];
}> {
  return authJson('/api/asset-classifications', { method: 'GET' });
}

export async function createWorkOrder(body: Record<string, unknown>): Promise<{
  work_order: WorkOrderDetail;
}> {
  return authJson(cmmsPaths.workOrders, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createWorkPlan(body: Record<string, unknown>): Promise<{
  work_plan: unknown;
}> {
  return authJson(cmmsPaths.workPlans, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createAsset(body: Record<string, unknown>): Promise<{
  asset: AssetRow;
}> {
  return authJson(cmmsPaths.assets, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
