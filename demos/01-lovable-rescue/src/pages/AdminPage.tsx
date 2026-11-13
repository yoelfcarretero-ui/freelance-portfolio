import { useState } from 'react';
import { Alert, Badge, Button, PageHeader, Spinner } from '../components/ui';
import { useData } from '../context/DataContext';
import { DataLayerError } from '../data';
import { formatDateTime } from '../lib/format';
import { dateKeyInZone, toEpoch } from '../lib/slots';
import { useAsync } from '../lib/useAsync';

type Filter = 'upcoming' | 'all' | 'cancelled';

export function AdminPage() {
  const data = useData();
  const { data: bookings, error, loading, reload } = useAsync(() => data.listAllBookings(), [data]);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);

  const now = Date.now();
  const today = dateKeyInZone(new Date());
  const all = bookings ?? [];
  const upcoming = all.filter((b) => b.status === 'confirmed' && toEpoch(b.starts_at) > now);
  const stats = [
    { label: 'Upcoming', value: upcoming.length },
    { label: 'Today', value: upcoming.filter((b) => dateKeyInZone(new Date(b.starts_at)) === today).length },
    { label: 'Customers', value: new Set(all.map((b) => b.user_id)).size },
    { label: 'Cancelled', value: all.filter((b) => b.status === 'cancelled').length },
  ];
  const rows = filter === 'upcoming' ? upcoming : filter === 'cancelled' ? all.filter((b) => b.status === 'cancelled') : all;

  async function cancel(id: string) {
    setActionError(null);
    try {
      await data.cancelBooking(id);
      reload();
    } catch (err) {
      setActionError(err instanceof DataLayerError ? err.message : 'Could not cancel the booking.');
    }
  }

  return (
    <div>
      <PageHeader title="Admin" subtitle="Every booking in the salon. Visible only to accounts with the admin role." />

      <dl className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 flex gap-2" role="group" aria-label="Filter bookings">
        {(['upcoming', 'all', 'cancelled'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'primary' : 'secondary'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {actionError && (
        <div className="mb-4">
          <Alert>{actionError}</Alert>
        </div>
      )}
      {loading && !bookings && <Spinner />}
      {error && <Alert>Could not load bookings: {error.message}</Alert>}

      {bookings && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">When (Madrid)</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-stone-500">
                    No bookings to show.
                  </td>
                </tr>
              )}
              {rows.map((b) => {
                const isFuture = toEpoch(b.starts_at) > now;
                return (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{formatDateTime(b.starts_at)}</td>
                    <td className="px-4 py-3">
                      <div>{b.customer_name}</div>
                      <div className="text-xs text-stone-500">{b.customer_email}</div>
                    </td>
                    <td className="px-4 py-3">{b.service_name}</td>
                    <td className="px-4 py-3">
                      {b.status === 'cancelled' ? (
                        <Badge tone="grey">Cancelled</Badge>
                      ) : isFuture ? (
                        <Badge tone="green">Confirmed</Badge>
                      ) : (
                        <Badge tone="amber">Done</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {b.status === 'confirmed' && isFuture && (
                        <Button variant="danger" onClick={() => cancel(b.id)}>
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
