import { Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Spinner } from '../components/ui';
import { useData } from '../context/DataContext';
import { formatPrice } from '../lib/format';
import { SALON } from '../lib/salon';
import { useAsync } from '../lib/useAsync';

export function HomePage() {
  const data = useData();
  const { data: services, error, loading } = useAsync(() => data.listServices(), [data]);

  return (
    <div>
      <section className="mb-12 overflow-hidden rounded-2xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-600 px-6 py-12 text-white sm:px-12">
        <p className="text-sm font-medium uppercase tracking-widest text-teal-100">{SALON.name}</p>
        <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Book your next appointment in under a minute.
        </h1>
        <p className="mt-4 max-w-lg text-teal-50">
          Pick a service, choose a free slot and you are done. Open Monday to Saturday, 9:00 to 19:00.
        </p>
      </section>

      <h2 className="mb-4 text-xl font-semibold">Services</h2>
      {loading && <Spinner />}
      {error && <Alert>Could not load services: {error.message}</Alert>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services?.map((service) => (
          <li key={service.id} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-semibold">{service.name}</h3>
              <span className="font-semibold text-teal-800">{formatPrice(service.price_cents)}</span>
            </div>
            <p className="mt-2 flex-1 text-sm text-stone-600">{service.description}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {service.duration_minutes} min
              </span>
              <Link
                to={`/book/${service.id}`}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
                aria-label={`Book ${service.name}`}
              >
                Book
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
