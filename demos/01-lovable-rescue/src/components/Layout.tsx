import { CalendarCheck, LogOut, Scissors, ShieldCheck } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { SALON } from '../lib/salon';
import { Button } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-teal-50 text-teal-800' : 'text-stone-600 hover:text-stone-900'}`;

export function Layout() {
  const { session, isAdmin, signOut } = useAuth();
  const data = useData();
  const navigate = useNavigate();

  async function handleSignOut() {
    // Leave protected pages first, otherwise their guard would redirect to /login
    // (remembering the page as "from") a moment before we land on the home page.
    navigate('/');
    await signOut();
  }

  return (
    <div className="flex min-h-screen flex-col">
      {data.mode === 'local' && (
        <div className="bg-stone-900 px-4 py-2 text-center text-xs text-stone-200">
          Demo mode: no backend, data lives in your browser.{' '}
          <span className="text-stone-400">Run with Supabase by setting the env vars in .env.local.</span>
        </div>
      )}

      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-white">
              <Scissors className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block font-semibold">SlotBook</span>
              <span className="block text-xs text-stone-500">{SALON.name}</span>
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              Services
            </NavLink>
            {session && (
              <NavLink to="/bookings" className={navClass}>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarCheck className="h-4 w-4" aria-hidden="true" /> My bookings
                </span>
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin" className={navClass}>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Admin
                </span>
              </NavLink>
            )}
            {session ? (
              <div className="flex items-center gap-2 sm:ml-2 sm:border-l sm:border-stone-200 sm:pl-3">
                <span className="hidden text-sm text-stone-500 sm:inline">{session.profile.full_name || session.user.email}</span>
                <Button variant="ghost" onClick={handleSignOut} aria-label="Log out">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="ml-2 flex items-center gap-2">
                <Link to="/login" className="px-3 py-2 text-sm font-medium text-stone-700 hover:text-stone-900">
                  Log in
                </Link>
                <Link
                  to="/signup"
                  className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
                >
                  Sign up
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-stone-500 sm:flex-row sm:justify-between">
          <span>
            {SALON.name} - Calle Ficticia 12, Madrid. All times shown in Madrid time.
          </span>
          <span>Portfolio demo by Yoel Carretero</span>
        </div>
      </footer>
    </div>
  );
}
