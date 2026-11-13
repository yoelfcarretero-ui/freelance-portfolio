import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Spinner, TextField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { DataLayerError } from '../data';
import { DEMO_ACCOUNTS } from '../data/seed';

function useRedirectTarget(): string {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/';
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-stone-600">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const data = useData();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Wait for the session restore so a logged-in user is not shown the form for a split second.
  if (loading) return <Spinner />;
  if (session) return <Navigate to={target} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof DataLayerError ? err.message : 'Could not log in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Log in to book and manage your appointments.">
      <form onSubmit={submit} className="space-y-4">
        <TextField id="email" label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Logging in...' : 'Log in'}
        </Button>
      </form>

      {data.mode === 'local' && (
        <div className="mt-6 rounded-lg bg-stone-50 p-4 text-sm">
          <p className="font-medium text-stone-700">Demo accounts (local mode only)</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['customer', 'admin'] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="secondary"
                onClick={() => {
                  setEmail(DEMO_ACCOUNTS[kind].email);
                  setPassword(DEMO_ACCOUNTS[kind].password);
                }}
              >
                Use {kind} account
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-stone-600">
        New here?{' '}
        <Link to="/signup" state={{ from: target }} className="font-medium text-teal-700 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

export function SignupPage() {
  const { session, loading, signUp } = useAuth();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkInbox, setCheckInbox] = useState(false);
  const [busy, setBusy] = useState(false);

  // Wait for the session restore so a logged-in user is not shown the form for a split second.
  if (loading) return <Spinner />;
  if (session) return <Navigate to={target} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signUp({ email, password, fullName });
      if (result.needsEmailConfirmation) setCheckInbox(true);
      else navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof DataLayerError ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  if (checkInbox) {
    return (
      <AuthCard title="Check your inbox" subtitle={`We sent a confirmation link to ${email}.`}>
        <p className="text-sm text-stone-600">Open the link to activate your account, then come back and log in.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="It takes 20 seconds. No card required.">
      <form onSubmit={submit} className="space-y-4">
        <TextField id="fullName" label="Full name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <TextField id="email" label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          id="password"
          label="Password (min. 8 characters)"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Creating account...' : 'Sign up'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-stone-600">
        Already have an account?{' '}
        <Link to="/login" state={{ from: target }} className="font-medium text-teal-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
