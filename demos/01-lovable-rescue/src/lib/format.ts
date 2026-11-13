import { SALON } from './salon';

const priceFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100);
}

/** Formats a UTC ISO instant in the SALON's timezone, not the viewer's. */
export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatSlotDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${formatSlotDate(iso)}, ${formatSlotTime(iso)}`;
}
