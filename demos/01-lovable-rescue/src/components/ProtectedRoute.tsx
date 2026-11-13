import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';

interface Props {
  children: ReactNode;
  requireAdmin?: boolean;
}

/**
 * Route guard (the React equivalent of an Angular CanActivate guard).
 *
 * BUG B fix (part 3): the original guard checked `if (!user) navigate('/login')` on the
 * first render, before Supabase had restored the session from storage, so every refresh
 * of a protected page bounced the user to /login. We now wait for `loading` to finish.
 */
export function ProtectedRoute({ children, requireAdmin = false }: Props) {
  const { session, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex justify-center py-24" role="status" aria-label="Restoring session">
        <Spinner />
      </div>
    );
  }

  if (!session) {
    // Remember where the user wanted to go so login can send them back there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-2xl font-semibold">Admins only</h1>
        <p className="mt-2 text-stone-600">Your account does not have access to this page.</p>
        <Link to="/" className="mt-6 inline-block text-teal-700 underline">
          Back to services
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
