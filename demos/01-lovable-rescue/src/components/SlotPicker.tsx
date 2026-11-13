import { formatSlotTime } from '../lib/format';
import type { SlotAvailability } from '../lib/slots';

interface Props {
  slots: SlotAvailability[];
  selected: string | null;
  onSelect: (startsAt: string) => void;
}

const reasonLabel = { booked: 'Booked', past: 'Past' } as const;

/** Grid of time slots for one day. Unavailable slots are rendered but disabled. */
export function SlotPicker({ slots, selected, onSelect }: Props) {
  if (slots.length === 0) {
    return <p className="text-sm text-stone-500">The salon is closed on this day.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" role="group" aria-label="Available times">
      {slots.map((slot) => {
        const isSelected = selected === slot.startsAt;
        const time = formatSlotTime(slot.startsAt);
        return (
          <button
            key={slot.startsAt}
            type="button"
            disabled={!slot.available}
            aria-pressed={isSelected}
            aria-label={slot.available ? time : `${time} (${reasonLabel[slot.reason!]})`}
            onClick={() => onSelect(slot.startsAt)}
            className={[
              'rounded-lg px-3 py-2.5 text-sm font-medium transition',
              slot.available
                ? isSelected
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'bg-white text-stone-800 ring-1 ring-stone-300 hover:ring-teal-600'
                : 'cursor-not-allowed bg-stone-100 text-stone-400 line-through',
            ].join(' ')}
          >
            {time}
          </button>
        );
      })}
    </div>
  );
}
