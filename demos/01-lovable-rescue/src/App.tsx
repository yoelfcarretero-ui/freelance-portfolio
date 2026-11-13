import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminPage } from './pages/AdminPage';
import { LoginPage, SignupPage } from './pages/AuthPages';
import { BookPage } from './pages/BookPage';
import { HomePage } from './pages/HomePage';
import { MyBookingsPage } from './pages/MyBookingsPage';

/**
 * Client-side routes. On a static host every one of these URLs must be rewritten to
 * index.html, otherwise a refresh on /bookings returns 404 (BUG E: see vercel.json and
 * public/_redirects).
 */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="book/:serviceId" element={<BookPage />} />
        <Route
          path="bookings"
          element={
            <ProtectedRoute>
              <MyBookingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={
            <div className="py-24 text-center">
              <h1 className="text-2xl font-semibold">Page not found</h1>
              <Link to="/" className="mt-4 inline-block text-teal-700 underline">
                Back to services
              </Link>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
