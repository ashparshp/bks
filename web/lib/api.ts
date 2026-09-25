import type { DashboardStats, Lead, LeadEvent } from './types';

const apiURL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiURL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ? `${data.error} (HTTP ${response.status})` : `Request failed (HTTP ${response.status})`);
  return data as T;
}

export const api = {
  listLeads: (query = '') => request<Lead[]>(`/api/leads?q=${encodeURIComponent(query)}`),
  dashboard: () => request<DashboardStats>('/api/dashboard'),
  createLead: (payload: Record<string, FormDataEntryValue>) => request<{ id: number }>('/api/leads', { method: 'POST', body: JSON.stringify(payload) }),
  importLeads: (csv: FormDataEntryValue | null, url: FormDataEntryValue | null) => request<{ imported: number; rows: number; skipped: number; duplicates: number; empty: number; invalid: number }>('/api/import', { method: 'POST', body: JSON.stringify({ CSV: csv, URL: url }) }),
  sendCampaign: (payload: Record<string, unknown>) => request<{ sent: number }>('/api/automation/send', { method: 'POST', body: JSON.stringify(payload) }),
  events: (leadID: number) => request<LeadEvent[]>(`/api/leads/${leadID}/events`),
  recordReply: (leadID: number, content: string) => request<{ ok: boolean }>(`/api/leads/${leadID}/reply`, { method: 'POST', body: JSON.stringify({ content }) }),
  markInvalid: (leadID: number) => request<{ ok: boolean }>(`/api/leads/${leadID}/invalid`, { method: 'PATCH' }),
};
