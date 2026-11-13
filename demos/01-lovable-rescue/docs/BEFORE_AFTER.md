# Before / After: six production bugs in an AI-built booking app

SlotBook started life as a typical AI-generated (Lovable-style) React + Supabase app. It looked
finished: nice UI, login, a booking flow, an admin page. Then real customers started using it.

This document walks through the six bugs I found and fixed, in the order a client usually
discovers them. Each one has the symptom the client reported, the root cause, the code before
and after, and how the fix was verified. The code in this repository is the **after** version.

| # | Bug | Severity | Where the fix lives |
|---|-----|----------|---------------------|
| A | RLS disabled on `bookings`: anyone with the anon key can read every booking | Critical (data leak) | `supabase/migrations/20260101000000_initial_schema.sql` |
| B | User logged out on every page refresh | High (UX, lost bookings) | `src/context/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`, `src/lib/supabaseClient.ts` |
| C | Two customers can book the same slot | High (business logic) | migration (unique index) + `src/data/supabaseDataLayer.ts` + `src/pages/BookPage.tsx` |
| D | `service_role` key shipped in the frontend bundle | Critical (full database takeover) | `src/lib/supabaseClient.ts`, `.env.example` |
| E | Blank page / 404 on refresh after deploying | High (site looks down) | `vercel.json`, `public/_redirects` |
| F | Appointments shown one or two hours off | High (no-shows) | migration (`timestamptz`) + `src/lib/slots.ts` |

---

## A. Row Level Security disabled on `bookings`

**What the client saw.** Nothing, at first. Then a customer emailed: "Why can I see other
people's names and phone numbers in the network tab?" Anyone can open DevTools, copy the anon
key (it is public by design) and run `select *` against the REST API.

**Root cause.** The generated migration created the table but never enabled RLS. In Supabase,
a table without RLS is fully readable and writable through the auto-generated API by anyone
holding the anon key. The UI filtered bookings by user in JavaScript, which hides the data
on screen but protects nothing.

**Before**

```sql
create table bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  service_id uuid references services,
  booking_date text,
  booking_time text,
  customer_name text,
  customer_phone text
);
-- (no "enable row level security", no policies)
```

```ts
// MyBookings.tsx - "security" in the browser
const { data } = await supabase.from('bookings').select('*');
const mine = data.filter((b) => b.user_id === user.id);
```

**After**

```sql
alter table public.bookings enable row level security;

create policy "bookings: read own or admin reads all"
  on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "bookings: create own future confirmed booking"
  on public.bookings for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'confirmed' and starts_at > now());

create policy "bookings: update own or admin updates any"
  on public.bookings for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- Customers may only change the status column (cancel), never move or re-assign a booking.
revoke update on public.bookings from authenticated, anon;
grant update (status) on public.bookings to authenticated;
revoke all on public.bookings from anon;
```

Two related problems were fixed at the same time:

- **Availability without leaking data.** Once RLS hides other people's bookings, the
  booking page can no longer see which slots are taken. The fix is a `SECURITY DEFINER`
  function `get_booked_slots(from, to)` that returns start times only, never names.
- **Privilege escalation.** The original `profiles` table let users update their own row,
  including `role`. A column-level grant now allows updating `full_name` only, and the signup
  trigger ignores any `role` sent in user metadata.

**How it was verified.** `npm run verify:db` applies the migration to a throwaway Postgres 17
container (with Supabase's `auth.uid()` and roles stubbed) and checks, among others:

```
 3 bob sees bookings (expect 0)                    |     0
 4 bob sees availability via rpc (expect 1)        |     1
 5 bob tries booking on behalf of alice  -> ERROR: new row violates row-level security policy
 7 bob cancels alice booking (expect 0 rows)       |     0
 8 bob promotes himself to admin         -> ERROR: permission denied for table profiles
11 anon reads bookings                   -> ERROR: permission denied for table bookings
12 admin sees all bookings (expect 1)              |     1
```

The local data layer mirrors the same rules and is covered by unit tests
(`only lists the current user's bookings`, `does not let a customer cancel somebody else's
booking`, `only admins can list every booking`).

---

## B. Logged out on every page refresh

**What the client saw.** "Customers log in, go to My bookings, press F5 and land on the login
page again. Some give up and phone the salon instead."

**Root cause.** Three small mistakes that add up:

1. The route guard ran on the first render, when `user` was still `null` because Supabase had
   not yet read the session from `localStorage`. `null` was treated as "logged out".
2. The app read the user once with `getUser()` in a `useEffect` and never subscribed to
   `onAuthStateChange`, so token refreshes and logins in another tab were missed.
3. The client was created with `persistSession: false` (copied from a server-side example).

**Before**

```tsx
// supabase.ts
export const supabase = createClient(url, key, { auth: { persistSession: false } });

// ProtectedRoute.tsx
const [user, setUser] = useState<User | null>(null);
useEffect(() => {
  supabase.auth.getUser().then(({ data }) => setUser(data.user));
}, []);
if (!user) return <Navigate to="/login" />;   // runs before getUser() resolves
return children;
```

**After**

```tsx
// AuthContext.tsx
const [session, setSession] = useState<Session | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  let active = true;
  const unsubscribe = data.onAuthStateChange((next) => {     // 1. subscribe first
    if (!active) return;
    setSession(next);
    setLoading(false);
  });
  data.getSession()                                           // 2. then restore
    .then((restored) => active && setSession(restored))
    .finally(() => active && setLoading(false));
  return () => { active = false; unsubscribe(); };            // 3. clean up
}, [data]);

// ProtectedRoute.tsx
if (loading) return <Spinner />;                              // wait, do not redirect yet
if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
```

The client now uses `persistSession: true` and `autoRefreshToken: true`, and the
`onAuthStateChange` callback defers the profile query with `setTimeout`, as the Supabase docs
recommend, to avoid a dead-lock on the auth lock. Login also sends the user back to the page
they were trying to open.

**How it was verified.** `src/components/ProtectedRoute.test.tsx` renders the whole app with
a data layer whose session restore takes 50 ms and asserts that the first render shows
"Restoring session" (not the login page) and that "My bookings" appears once the session is
restored. `localDataLayer.test.ts` checks that a fresh instance (a refresh) restores the
session. In the production build, the screenshot script logs in and then does full page loads
of `/book/<id>` and `/admin` (the same as pressing F5); the user stays logged in.

---

## C. Double booking

**What the client saw.** Two customers turned up for the same 10:00 slot. It happened on busy
Monday mornings when several people booked at once.

**Root cause.** The availability check lived only in the browser: select bookings for that
time, and if there are none, insert. Two requests that arrive within a few milliseconds both
see "free" and both insert. This is a classic check-then-act race; no amount of frontend code
can fix it, because the browser cannot lock the database.

**Before**

```ts
const { data: existing } = await supabase
  .from('bookings')
  .select('id')
  .eq('booking_date', date)
  .eq('booking_time', time);

if (existing.length === 0) {
  await supabase.from('bookings').insert({ booking_date: date, booking_time: time, ... });
  toast.success('Booked!');
}
```

**After** - the database is the single source of truth:

```sql
-- At most ONE confirmed booking per slot. Partial, so a cancelled booking frees the slot.
create unique index bookings_one_per_slot
  on public.bookings (starts_at)
  where status = 'confirmed';
```

```ts
// supabaseDataLayer.ts
const { data, error } = await this.client.from('bookings').insert({ ... }).select().single();
if (error?.code === '23505') throw new SlotTakenError();   // unique_violation

// BookPage.tsx
} catch (err) {
  if (err instanceof SlotTakenError) {
    setSelected(null);
    booked.reload();          // grid now shows the slot as taken
  }
  setSubmitError(err.message); // "Sorry, someone has just booked that slot..."
}
```

**How it was verified.**

- `npm run verify:db` opens two real concurrent transactions against Postgres. Session A
  inserts 10:00 and holds the transaction open for 3 seconds; session B inserts the same
  instant (written as `+01:00` instead of `Z`). B blocks, then fails once A commits:

  ```
  [B] B inserting same slot while A is still open...
  [B] ERROR:  duplicate key value violates unique constraint "bookings_one_per_slot"
  [A] A committed
  ```
- Unit tests: `maps a unique violation (23505) to SlotTakenError`, `rejects a double booking
  of the same slot by another user`, `frees the slot again when the booking is cancelled`,
  and the UI test `explains a lost race instead of crashing`.

---

## D. `service_role` key in the frontend

**What the client saw.** Nothing visible, which is what makes it dangerous. It came up during
my audit: searching the built JS for `eyJ` found two JWTs, and one decoded to
`"role": "service_role"`.

**Root cause.** RLS policies were blocking an admin query, so the AI assistant "fixed" it by
switching the client to the service role key, stored as `VITE_SUPABASE_SERVICE_ROLE_KEY`.
Every `VITE_*` variable is inlined into the public bundle at build time, and the service role
key bypasses RLS completely. Anyone visiting the site could read, change or delete every row,
including `auth` data.

**Before**

```ts
// .env (committed!)
VITE_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

// supabase.ts
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY, // "to make the admin page work"
);
```

**After**

```ts
// supabaseClient.ts
export function assertBrowserSafeKey(key: string): void {
  if (key.startsWith('sb_secret_')) throw new InsecureKeyError();      // new key format
  const payload = decodeJwtPayload(key);                                // legacy JWT keys
  if (payload?.role === 'service_role') throw new InsecureKeyError();
}
```

- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exist, documented in `.env.example`.
  `.env*` files are git-ignored.
- The admin page works through RLS instead (`public.is_admin()` in the policies), so there
  is no reason to reach for a privileged key at all.
- If a secret key is ever pasted into the env var, the app refuses to boot and shows a
  configuration error instead of silently running with full privileges.
- Real-world follow-up for a client: **rotate the leaked key immediately** in the Supabase
  dashboard, because it is in every copy of the old bundle and possibly in git history.

**How it was verified.** `src/data/config.test.ts` (`refuses service_role and secret keys`,
`accepts anon and publishable keys`). After `npm run build`, the bundle contains no JWT
(`grep -c eyJ dist/assets/*.js` returns 0) and `service_role` only appears inside the guard itself.

---

## E. Blank page / 404 after deploying

**What the client saw.** "The site works when I click around, but if I refresh on
/bookings, or share a link to a service, I get a 404 (Vercel) or a blank page (Netlify)."

**Root cause.** React Router handles routes in the browser. A static host receiving a
request for `/bookings` looks for a file called `bookings`, does not find it, and returns 404.
The host must be told to serve `index.html` for every path and let the router take over.
(`npm run dev` hides the problem because Vite's dev server already does this.)

**Before**

```
(no vercel.json, no _redirects)
```

**After**

```json
// vercel.json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

```
# public/_redirects  (Netlify, Cloudflare Pages)
/*    /index.html   200
```

Vercel serves real files (JS, CSS, images) before applying rewrites, so assets are not
affected. The app also has a proper "Page not found" route for genuinely wrong URLs.

**How it was verified.** Production build served with `npm run preview`, then direct loads of
`/bookings`, `/admin` and `/book/<id>` (Playwright screenshots in `docs/screenshots/` are taken
this way). On Vercel / Netlify the rewrite files are the documented mechanism; see README
for the deployment steps.

---

## F. Times stored as local strings

**What the client saw.** "A customer in the Canary Islands booked 10:00 and turned up at
11:00." And, after the clocks changed in March, every booking in the admin view was an hour
off.

**Root cause.** Dates were stored as text (`'2025-03-04'`, `'10:00'`) or in a
`timestamp without time zone` column, built from the browser's local clock. The value had no
timezone, so its meaning depended on whoever read it. The browser then parsed it with
`new Date('2025-03-04 10:00')`, which uses the *viewer's* timezone, and the admin page
formatted it again in another one.

**Before**

```sql
booking_date text,
booking_time text
-- or later: starts_at timestamp   -- without time zone
```

```ts
const startsAt = `${date} ${time}`;                     // "2025-03-04 10:00"
await supabase.from('bookings').insert({ starts_at: startsAt });
// display
new Date(booking.starts_at).toLocaleTimeString();        // viewer's timezone
```

**After**

```sql
starts_at timestamptz not null,
ends_at   timestamptz not null,
constraint bookings_valid_range check (ends_at > starts_at)
```

```ts
// slots.ts: "10:00 in Madrid on 4 March" -> real instant, DST-aware, no library needed
const start = zonedWallTimeToUtc('2026-03-04', 10, 0, 'Europe/Madrid'); // 09:00Z
insert({ starts_at: start.toISOString() });               // "2026-03-04T09:00:00.000Z"

// format.ts: always display in the salon's timezone
new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
```

The rule is simple: store instants (UTC, `timestamptz`), convert at the edges, and display in
the timezone that matters for the business (the salon's), labelled as such in the UI.

**How it was verified.** `src/lib/slots.test.ts` covers summer (UTC+2), winter (UTC+1), the
DST change day, a UTC/Madrid date boundary and comparing values written with different
offsets. In SQL, `'2026-07-15T10:00:00+02:00'::timestamptz = '2026-07-15T08:00:00Z'` returns
true, and the race test above inserts the same instant with two different offsets and still
gets the unique violation.

---

## Summary for the client

- Data is now protected by the database, not by the UI. A leaked anon key exposes nothing private.
- No privileged keys in the browser, with a guard that fails loudly if one is added.
- Booking is race-safe; customers who lose a race get a clear message and a refreshed grid.
- Sessions survive refreshes, tabs and token expiry.
- Deep links and refreshes work on Vercel and Netlify.
- Times are stored as absolute instants and shown in salon time.
- 47 automated tests plus a database check script guard against regressions.
