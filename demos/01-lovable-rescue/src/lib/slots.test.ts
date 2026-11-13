import { describe, expect, it } from 'vitest';
import {
  dateKeyInZone,
  dayRangeUtc,
  generateDaySlots,
  getBookableDays,
  getDayAvailability,
  isBookableSlot,
  zonedWallTimeToUtc,
} from './slots';

// Wednesday 15 July 2026, 07:30 UTC = 09:30 in Madrid (CEST, UTC+2).
const SUMMER_NOW = new Date('2026-07-15T07:30:00Z');

describe('timezone conversion (BUG F regression tests)', () => {
  it('converts Madrid wall-clock time to UTC in summer (UTC+2)', () => {
    expect(zonedWallTimeToUtc('2026-07-15', 10, 0, 'Europe/Madrid').toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('converts Madrid wall-clock time to UTC in winter (UTC+1)', () => {
    expect(zonedWallTimeToUtc('2026-01-15', 10, 0, 'Europe/Madrid').toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('handles the DST change day (last Sunday of March)', () => {
    // 29 March 2026: clocks jump 02:00 -> 03:00. 10:00 is already CEST.
    expect(zonedWallTimeToUtc('2026-03-29', 10, 0, 'Europe/Madrid').toISOString()).toBe('2026-03-29T08:00:00.000Z');
  });

  it('uses the salon calendar day, not the UTC day', () => {
    // 23:30 UTC on the 14th is already the 15th in Madrid.
    expect(dateKeyInZone(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
  });

  it('dayRangeUtc covers exactly one Madrid day', () => {
    expect(dayRangeUtc('2026-07-15')).toEqual({
      from: '2026-07-14T22:00:00.000Z',
      to: '2026-07-15T22:00:00.000Z',
    });
  });
});

describe('generateDaySlots', () => {
  it('creates hourly slots 09:00-19:00 skipping the 14:00 lunch hour', () => {
    const slots = generateDaySlots('2026-07-15');
    expect(slots).toHaveLength(9);
    expect(slots[0]).toEqual({ startsAt: '2026-07-15T07:00:00.000Z', endsAt: '2026-07-15T08:00:00.000Z' });
    expect(slots.at(-1)!.startsAt).toBe('2026-07-15T16:00:00.000Z'); // 18:00 Madrid
    expect(slots.map((s) => s.startsAt)).not.toContain('2026-07-15T12:00:00.000Z'); // 14:00 Madrid
  });

  it('returns no slots on Sunday', () => {
    expect(generateDaySlots('2026-07-19')).toEqual([]);
  });
});

describe('getBookableDays', () => {
  it('starts today (salon time), skips Sundays and spans the booking window', () => {
    const days = getBookableDays(SUMMER_NOW, 7);
    expect(days[0]).toBe('2026-07-15');
    expect(days).not.toContain('2026-07-19');
    expect(days).toHaveLength(6);
  });
});

describe('getDayAvailability', () => {
  it('marks past and booked slots as unavailable', () => {
    const booked = ['2026-07-15T09:00:00+00:00']; // 11:00 Madrid, in Postgres output format
    const slots = getDayAvailability('2026-07-15', booked, SUMMER_NOW);
    const byStart = Object.fromEntries(slots.map((s) => [s.startsAt, s]));

    expect(byStart['2026-07-15T07:00:00.000Z']).toMatchObject({ available: false, reason: 'past' }); // 09:00
    expect(byStart['2026-07-15T08:00:00.000Z']).toMatchObject({ available: true }); // 10:00
    expect(byStart['2026-07-15T09:00:00.000Z']).toMatchObject({ available: false, reason: 'booked' }); // 11:00
  });
});

describe('isBookableSlot', () => {
  it('accepts a future slot on the grid', () => {
    expect(isBookableSlot('2026-07-15T08:00:00.000Z', SUMMER_NOW)).toBe(true);
  });

  it.each([
    ['in the past', '2026-07-15T07:00:00.000Z'],
    ['off the grid', '2026-07-15T08:15:00.000Z'],
    ['during lunch', '2026-07-15T12:00:00.000Z'],
    ['on a Sunday', '2026-07-19T08:00:00.000Z'],
    ['outside the booking window', '2026-09-01T08:00:00.000Z'],
    ['not a date', 'tomorrow at ten'],
  ])('rejects a slot %s', (_label, iso) => {
    expect(isBookableSlot(iso, SUMMER_NOW)).toBe(false);
  });
});
