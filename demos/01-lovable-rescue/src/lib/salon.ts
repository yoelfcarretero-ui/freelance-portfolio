/**
 * Business rules for the fictional salon. In a real project these would live in a
 * settings table; constants keep the demo simple.
 */
export interface SalonConfig {
  name: string;
  timeZone: string;
  openingHour: number;
  closingHour: number;
  lunchHour: number;
  closedWeekdays: readonly number[];
  slotMinutes: number;
  bookingWindowDays: number;
}

export const SALON: Readonly<SalonConfig> = {
  name: 'Studio Lumen',
  /** IANA timezone of the salon. All opening hours are expressed in this zone. */
  timeZone: 'Europe/Madrid',
  /** Opening hours as [startHour, endHour) on the salon's wall clock. */
  openingHour: 9,
  closingHour: 19,
  /** Hour that is blocked for lunch. */
  lunchHour: 14,
  /** 0 = Sunday ... 6 = Saturday. */
  closedWeekdays: [0],
  /** One chair: every slot can hold exactly one booking. */
  slotMinutes: 60,
  /** How many days ahead customers can book. */
  bookingWindowDays: 14,
};
