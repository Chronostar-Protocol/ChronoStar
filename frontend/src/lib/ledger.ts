import { STELLAR_RPC_URL } from "./network";
import type { ScheduleEvent } from "@/types";

export interface CalendarReminderOptions {
  network: string;
  estimatedUtc: Date;
  detailUrl: string;
  reminderMinutes?: number;
}

/**
 * Builds an RFC 5545 calendar event for an upcoming ledger schedule. The
 * timestamp is explicitly labelled as an estimate because ledger close times
 * are not a wall-clock guarantee.
 */
export function scheduleReminderIcs(
  schedule: ScheduleEvent,
  { network, estimatedUtc, detailUrl, reminderMinutes = 0 }: CalendarReminderOptions,
): string {
  const utc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const uid = `chronostar-${network}-${schedule.type}-${schedule.id}-${schedule.targetLedger}@chronostar`;
  const alarm = reminderMinutes > 0
    ? `BEGIN:VALARM\r\nTRIGGER:-PT${reminderMinutes}M\r\nACTION:DISPLAY\r\nDESCRIPTION:ChronoStar schedule reminder\r\nEND:VALARM`
    : '';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChronoStar//Schedule Reminder//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(estimatedUtc)}`,
    `SUMMARY:ChronoStar ${schedule.type} #${schedule.id}`,
    `DESCRIPTION:Target ledger ${schedule.targetLedger}. Ledger-derived time is an estimate.`,
    `URL:${detailUrl}`,
    alarm,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].filter(Boolean).join('\r\n');
}

/**
 * Reads the latest closed ledger sequence from a Soroban RPC endpoint.
 * Throws when the endpoint is unreachable or answers with something that is
 * not a positive ledger number, so callers never display a guessed value.
 */
export async function fetchLatestLedger(
  rpcUrl: string = STELLAR_RPC_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
  });
  if (!res.ok) throw new Error(`getLatestLedger failed with status ${res.status}`);
  const body = await res.json();
  const sequence = Number(body?.result?.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("getLatestLedger returned no ledger sequence");
  }
  return sequence;
}
