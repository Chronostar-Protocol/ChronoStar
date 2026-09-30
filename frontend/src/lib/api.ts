import type {
  VaultEntry,
  StreamEntry,
  DCAEntry,
  DCAExecutionHistory,
  ScheduleEvent,
  Stats,
} from '@/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  getSchedules: (address: string) => fetchJSON<VaultEntry[]>(`/api/schedules/${address}`),
  getStreams: (address: string) => fetchJSON<StreamEntry[]>(`/api/streams/${address}`),
  getDCA: (address: string) => fetchJSON<DCAEntry[]>(`/api/dca/${address}`),
  getDCAHistory: (address: string, dcaId: number, start = 1, limit = 50) =>
    fetchJSON<DCAExecutionHistory>(
      `/api/dca/${address}/${dcaId}/history?start=${start}&limit=${limit}`,
    ),
  getEvents: (limit?: number) => fetchJSON<ScheduleEvent[]>(`/api/events${limit ? `?limit=${limit}` : ''}`),
  getStats: () => fetchJSON<Stats>('/api/stats'),
};
