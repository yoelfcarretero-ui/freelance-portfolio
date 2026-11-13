// Generates the README screenshots from a running build (local mode).
//
//   npm run build && npm run preview      (terminal 1)
//   npm run screenshots                   (terminal 2)
//
// Uses an installed Edge or Chrome via Playwright "channel", so no browser download is needed.
// Override with PW_CHANNEL=chrome or BASE_URL=http://localhost:5173.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173';
const CHANNEL = process.env.PW_CHANNEL ?? 'msedge';
const OUT = new URL('../docs/screenshots/', import.meta.url);
const SERVICE_ID = '6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: CHANNEL });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
const page = await context.newPage();
// Let CSS transitions settle so selected states are captured at full colour.
const shot = async (name, opts = {}) => (await page.waitForTimeout(400), page.screenshot({ path: new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...opts }));

async function login(kind) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('button', { name: `Use ${kind} account` }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

// 1. Home / services
await page.goto(BASE_URL);
await page.getByRole('link', { name: /^Book / }).first().waitFor();
await shot('01-services.png', { fullPage: true });

// 2. Login with demo accounts
await page.goto(`${BASE_URL}/login`);
await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
await shot('02-login.png');

// 3. Booking page with taken slots
await login('customer');
await page.goto(`${BASE_URL}/book/${SERVICE_ID}`);
await page.getByRole('group', { name: 'Available times' }).waitFor();
// Pick a day that has free slots (today may be over).
const days = page.getByRole('group', { name: 'Days' }).getByRole('button');
for (let i = 0; i < (await days.count()); i++) {
  await days.nth(i).click();
  await page.getByRole('group', { name: 'Available times' }).waitFor();
  const free = page.locator('[aria-label="Available times"] button:not([disabled])');
  if ((await free.count()) > 1) {
    await free.nth(1).click();
    break;
  }
}
await shot('03-book-slot.png', { fullPage: true });

// 4. My bookings after confirming
await page.getByRole('button', { name: 'Confirm booking' }).click();
await page.getByText('Booking confirmed').waitFor();
await page.getByRole('heading', { name: 'Upcoming' }).waitFor();
await shot('04-my-bookings.png', { fullPage: true });

// 5. Admin view
await page.getByRole('button', { name: 'Log out' }).click();
await page.getByRole('link', { name: 'Log in' }).waitFor();
await page.waitForURL(`${BASE_URL}/`);
await login('admin');
await page.goto(`${BASE_URL}/admin`);
await page.getByRole('table').waitFor();
await shot('05-admin.png', { fullPage: true });

// 6. Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE_URL}/book/${SERVICE_ID}`);
await page.getByRole('group', { name: 'Available times' }).waitFor();
await shot('06-mobile-booking.png', { fullPage: true });

await browser.close();
console.log('Screenshots written to docs/screenshots/');
