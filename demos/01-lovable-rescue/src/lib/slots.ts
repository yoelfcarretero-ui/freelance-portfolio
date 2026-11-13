/**
 * Slot generation and availability.
 *
 * Every instant in this app is a UTC `Date` / ISO string. The salon's opening hours are
 * defined on the salon's wall clock (Europe/Madrid), so we convert "Tuesday 10:00 in Madrid"
 * into a real instant here, once, and never pass naive "2025-03-04 10:00" strings around.
 * That naive-string approach was BUG F in the original app (see docs/BEFORE_AFTER.md).
 *
 * No date library is needed: the built-in Intl API knows every IANA timezone and its DST rules.
 */
import { SALON } from './salon';

export interface Slot {
  /** ISO-8601 UTC, e.g. "2026-07-15T08:00:00.000Z" */
  startsAt: string;
  endsAt: string;
}

export type UnavailableReason = 'booked' | 'past';

export interface SlotAvailability extends Slot {
  available: boolean;
  reason?: UnavailableReason;
}

const MINUTE = 60_000;

/** Offset of `timeZone` from UTC at `instant`, in minutes (Madrid summer = +120). */
export function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((wallClockAsUtc - instant.getTime()) / MINUTE);
}

/**
 * Converts a wall-clock time in `timeZone` to the real UTC instant.
 * @param dateKey "YYYY-MM-DD" as seen in that timezone
 */
export function zonedWallTimeToUtc(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  // First guess using the offset at the naive instant, then correct once in case
  // the guess landed on the other side of a DST change.
  const firstOffset = getTimeZoneOffsetMinutes(new Date(naive), timeZone);
  let result = naive - firstOffset * MINUTE;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(result), timeZone);
  if (secondOffset !== firstOffset) result = naive - secondOffset * MINUTE;
  return new Date(result);
}

/** "YYYY-MM-DD" of `instant` on the wall clock of `timeZone`. */
export function dateKeyInZone(instant: Date, timeZone: string = SALON.timeZone): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Day of week (0 = Sunday) of a calendar date key. Timezone independent by construction. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isClosedDay(dateKey: string): boolean {
  return SALON.closedWeekdays.includes(weekdayOfDateKey(dateKey));
}

/** Open days customers can pick, starting today (salon time). */
export function getBookableDays(now: Date, windowDays: number = SALON.bookingWindowDays): string[] {
  const today = dateKeyInZone(now);
  const days: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const key = addDaysToDateKey(today, i);
    if (!isClosedDay(key)) days.push(key);
  }
  return days;
}

/** All slots of a day according to opening hours, regardless of bookings. */
export function generateDaySlots(dateKey: string): Slot[] {
  if (isClosedDay(dateKey)) return [];
  const slots: Slot[] = [];
  const perHour = 60 / SALON.slotMinutes;
  for (let hour = SALON.openingHour; hour < SALON.closingHour; hour++) {
    if (hour === SALON.lunchHour) continue;
    for (let i = 0; i < perHour; i++) {
      const start = zonedWallTimeToUtc(dateKey, hour, i * SALON.slotMinutes, SALON.timeZone);
      slots.push({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + SALON.slotMinutes * MINUTE).toISOString(),
      });
    }
  }
  return slots;
}

/**
 * Normalises any ISO representation ("...Z", "...+00:00", "...+02:00") to epoch ms,
 * so values coming back from Postgres compare correctly with values generated here.
 */
export function toEpoch(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Marks each slot of the day as available or not.
 * @param bookedStartsAt start instants of confirmed bookings (any ISO format)
 */
export function getDayAvailability(
  dateKey: string,
  bookedStartsAt: readonly string[],
  now: Date,
): SlotAvailability[] {
  const booked = new Set(bookedStartsAt.map(toEpoch));
  return generateDaySlots(dateKey).map((slot) => {
    const start = toEpoch(slot.startsAt);
    if (start <= now.getTime()) return { ...slot, available: false, reason: 'past' };
    if (booked.has(start)) return { ...slot, available: false, reason: 'booked' };
    return { ...slot, available: true };
  });
}

/** Server-style validation: is this an existing, future, in-window slot? */
export function isBookableSlot(startsAtIso: string, now: Date): boolean {
  const start = toEpoch(startsAtIso);
  if (Number.isNaN(start) || start <= now.getTime()) return false;
  const dateKey = dateKeyInZone(new Date(start));
  if (!getBookableDays(now).includes(dateKey)) return false;
  return generateDaySlots(dateKey).some((s) => toEpoch(s.startsAt) === start);
}

export function slotEnd(startsAtIso: string): string {
  return new Date(toEpoch(startsAtIso) + SALON.slotMinutes * MINUTE).toISOString();
}

/** UTC range covering a whole salon day, used to query bookings for that day. */
export function dayRangeUtc(dateKey: string): { from: string; to: string } {
  return {
    from: zonedWallTimeToUtc(dateKey, 0, 0, SALON.timeZone).toISOString(),
    to: zonedWallTimeToUtc(addDaysToDateKey(dateKey, 1), 0, 0, SALON.timeZone).toISOString(),
  };
}
