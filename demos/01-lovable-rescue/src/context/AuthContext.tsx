import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '../lib/types';
import type { SignUpInput, SignUpResult } from '../data';
import { useData } from './DataContext';

interface AuthContextValue {
  session: Session | null;
  /**
   * True until the persisted session has been restored. Route guards MUST wait for this.
   * Redirecting while it is still true is exactly what caused BUG B (logged out on refresh).
   */
  loading: boolean;
  isAdmin: boolean;
  signIn(email: string, password: string): Promise<Session>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const data = useData();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // BUG B fix (part 2):
    // 1) Subscribe first, so sign-in / sign-out / token refresh events are never missed
    //    (including those fired by another tab or by an e-mail confirmation link).
    const unsubscribe = data.onAuthStateChange((next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    // 2) Then restore the session persisted in storage. Until this resolves we do NOT know
    //    whether the user is logged in, so `loading` stays true and guards wait.
    data
      .getSession()
      .then((restored) => {
        if (active) setSession(restored);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // 3) Clean up the listener on unmount (React StrictMode mounts effects twice in dev).
    return () => {
      active = false;
      unsubscribe();
    };
  }, [data]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await data.signIn(email, password);
      setSession(next);
      return next;
    },
    [data],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const result = await data.signUp(input);
      if (result.session) setSession(result.session);
      return result;
    },
    [data],
  );

  const signOut = useCallback(async () => {
    await data.signOut();
    setSession(null);
  }, [data]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, isAdmin: session?.profile.role === 'admin', signIn, signUp, signOut }),
    [session, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
