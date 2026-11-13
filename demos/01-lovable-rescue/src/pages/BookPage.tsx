import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SlotPicker } from '../components/SlotPicker';
import { Alert, Button, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { DataLayerError, SlotTakenError } from '../data';
import { formatDateTime, formatPrice } from '../lib/format';
import { SALON } from '../lib/salon';
import { dayRangeUtc, getBookableDays, getDayAvailability, zonedWallTimeToUtc } from '../lib/slots';
import { useAsync } from '../lib/useAsync';

function dayChipLabel(dateKey: string) {
  // Noon avoids any edge case around midnight when formatting the calendar date.
  const noon = zonedWallTimeToUtc(dateKey, 12, 0, SALON.timeZone);
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: SALON.timeZone, ...opts }).format(noon);
  return { weekday: fmt({ weekday: 'short' }), day: fmt({ day: 'numeric' }), month: fmt({ month: 'short' }) };
}

export function BookPage() {
  const { serviceId = '' } = useParams();
  const data = useData();
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const days = useMemo(() => getBookableDays(new Date()), []);
  const [day, setDay] = useState(days[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const service = useAsync(() => data.getService(serviceId), [data, serviceId]);
  const booked = useAsync(() => {
    const { from, to } = dayRangeUtc(day);
    return data.getBookedSlots(from, to);
  }, [data, day]);

  const slots = useMemo(() => getDayAvailability(day, booked.data ?? [], new Date()), [day, booked.data]);

  function pickDay(next: string) {
    setDay(next);
    setSelected(null);
    setSubmitError(null);
  }

  async function confirm() {
    if (!selected) return;
    if (!session) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const booking = await data.createBooking({ serviceId, startsAt: selected });
      navigate('/bookings', { state: { justBooked: booking.id } });
    } catch (err) {
      // BUG C fix (UI side): a lost race is an expected outcome, not a crash.
      // Explain it and refresh the grid so the taken slot shows as booked.
      if (err instanceof SlotTakenError) {
        setSelected(null);
        booked.reload();
      }
      setSubmitError(err instanceof DataLayerError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (service.loading) return <Spinner />;
  if (!service.data) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold">Service not found</h1>
        <Link to="/" className="mt-4 inline-block text-teal-700 underline">
          Back to services
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* min-w-0 lets the day strip scroll instead of widening the page on mobile */}
      <div className="min-w-0">
        <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All services
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{service.data.name}</h1>
        <p className="mt-2 text-stone-600">{service.data.description}</p>

        <h2 className="mt-8 mb-3 font-semibold">1. Pick a day</h2>
        <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Days">
          {days.map((key) => {
            const label = dayChipLabel(key);
            const active = key === day;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => pickDay(key)}
                className={`flex min-w-16 flex-col items-center rounded-xl px-3 py-2 text-sm transition ${
                  active ? 'bg-teal-700 text-white' : 'bg-white ring-1 ring-stone-200 hover:ring-teal-600'
                }`}
              >
                <span className="text-xs opacity-80">{label.weekday}</span>
                <span className="text-lg font-semibold">{label.day}</span>
                <span className="text-xs opacity-80">{label.month}</span>
              </button>
            );
          })}
        </div>

        <h2 className="mt-8 mb-3 font-semibold">2. Pick a time (Madrid time)</h2>
        {booked.loading ? <Spinner /> : <SlotPicker slots={slots} selected={selected} onSelect={setSelected} />}
        {booked.error && <Alert>Could not load availability: {booked.error.message}</Alert>}
      </div>

      <aside className="h-fit rounded-xl border border-stone-200 bg-white p-5 shadow-sm lg:sticky lg:top-24">
        <h2 className="font-semibold">Summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Service</dt>
            <dd className="text-right font-medium">{service.data.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">When</dt>
            <dd className="text-right font-medium">{selected ? formatDateTime(selected) : '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Price</dt>
            <dd className="text-right font-medium">{formatPrice(service.data.price_cents)}</dd>
          </div>
        </dl>
        {submitError && (
          <div className="mt-4">
            <Alert>{submitError}</Alert>
          </div>
        )}
        <Button className="mt-5 w-full" disabled={!selected || submitting} onClick={confirm}>
          {submitting ? 'Booking...' : session ? 'Confirm booking' : 'Log in to book'}
        </Button>
        <p className="mt-3 text-xs text-stone-500">Free cancellation from your bookings page.</p>
      </aside>
    </div>
  );
}
