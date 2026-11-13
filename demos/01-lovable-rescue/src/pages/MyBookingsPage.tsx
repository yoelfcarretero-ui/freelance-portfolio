import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Alert, Badge, Button, PageHeader, Spinner } from '../components/ui';
import { useData } from '../context/DataContext';
import { DataLayerError } from '../data';
import { formatDateTime } from '../lib/format';
import { toEpoch } from '../lib/slots';
import type { BookingWithDetails } from '../lib/types';
import { useAsync } from '../lib/useAsync';

export function MyBookingsPage() {
  const data = useData();
  const location = useLocation();
  const justBooked = (location.state as { justBooked?: string } | null)?.justBooked;
  const { data: bookings, error, loading, reload } = useAsync(() => data.listMyBookings(), [data]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function cancel(id: string) {
    setActionError(null);
    try {
      await data.cancelBooking(id);
      setConfirmingId(null);
      reload();
    } catch (err) {
      setActionError(err instanceof DataLayerError ? err.message : 'Could not cancel the booking.');
    }
  }

  const now = Date.now();
  const upcoming = bookings?.filter((b) => b.status === 'confirmed' && toEpoch(b.starts_at) > now) ?? [];
  const history = bookings?.filter((b) => !upcoming.includes(b)).reverse() ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My bookings" subtitle="Upcoming appointments and history." />
      {justBooked && (
        <div className="mb-6">
          <Alert tone="success">Booking confirmed. See you soon!</Alert>
        </div>
      )}
      {actionError && (
        <div className="mb-6">
          <Alert>{actionError}</Alert>
        </div>
      )}
      {loading && !bookings && <Spinner />}
      {error && <Alert>Could not load your bookings: {error.message}</Alert>}

      {bookings && (
        <>
          <h2 className="mb-3 font-semibold">Upcoming</h2>
          {upcoming.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
              No upcoming appointments.{' '}
              <Link to="/" className="text-teal-700 underline">
                Book one now
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((b) => (
                <BookingRow key={b.id} booking={b} highlight={b.id === justBooked}>
                  {confirmingId === b.id ? (
                    <div className="flex gap-2">
                      <Button variant="danger" onClick={() => cancel(b.id)}>
                        Yes, cancel
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={() => setConfirmingId(b.id)} aria-label={`Cancel ${b.service_name}`}>
                      Cancel
                    </Button>
                  )}
                </BookingRow>
              ))}
            </ul>
          )}

          {history.length > 0 && (
            <>
              <h2 className="mt-10 mb-3 font-semibold">History</h2>
              <ul className="space-y-3">
                {history.map((b) => (
                  <BookingRow key={b.id} booking={b}>
                    <Badge tone={b.status === 'cancelled' ? 'grey' : 'green'}>
                      {b.status === 'cancelled' ? 'Cancelled' : 'Completed'}
                    </Badge>
                  </BookingRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BookingRow({
  booking,
  highlight = false,
  children,
}: {
  booking: BookingWithDetails;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm ${
        highlight ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-stone-200'
      }`}
    >
      <div>
        <p className="font-medium">{booking.service_name}</p>
        <p className="text-sm text-stone-600">{formatDateTime(booking.starts_at)}</p>
      </div>
      {children}
    </li>
  );
}
