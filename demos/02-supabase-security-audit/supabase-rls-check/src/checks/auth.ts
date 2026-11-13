import { HttpError, type Getter } from '../http.js';
import { describeError, emptyOutput, type CheckOutput } from './common.js';

export interface AuthSettings {
  external?: Record<string, boolean>;
  disable_signup?: boolean;
  mailer_autoconfirm?: boolean;
  phone_autoconfirm?: boolean;
  anonymous_users?: boolean;
  sms_provider?: string;
  saml_enabled?: boolean;
}

export function analyzeAuthSettings(s: AuthSettings): CheckOutput {
  const out = emptyOutput();
  const enabled = Object.entries(s.external ?? {})
    .filter(([, on]) => on === true)
    .map(([name]) => name)
    .sort();

  if (s.mailer_autoconfirm === true && s.external?.email !== false) {
    out.findings.push({
      checkId: 'AUTH-EMAIL-AUTOCONFIRM',
      severity: 'medium',
      category: 'auth',
      title: 'Email confirmation is turned off',
      description:
        'New accounts are active immediately without proving they own the email address. Someone can sign up as "ceo@yourcompany.com" or as one of your customers and the app will trust that address.',
      evidence: ['GET /auth/v1/settings: mailer_autoconfirm = true'],
      impact:
        'Fake and spam accounts, impersonation of real customers, and abuse of any feature that trusts the email (invitations, domain-based access, notifications).',
      fix: 'Dashboard: **Authentication > Sign In / Providers > Email > Confirm email** = on. Configure a custom SMTP provider so confirmation emails are delivered reliably.',
      references: ['https://supabase.com/docs/guides/auth/auth-email'],
    });
  } else if (s.mailer_autoconfirm === false) {
    out.passed.push({ category: 'auth', title: 'Email confirmation is required', detail: 'mailer_autoconfirm = false' });
  }

  if (s.phone_autoconfirm === true && s.external?.phone === true) {
    out.findings.push({
      checkId: 'AUTH-PHONE-AUTOCONFIRM',
      severity: 'medium',
      category: 'auth',
      title: 'Phone sign-ups are not verified',
      description: 'Phone sign-up is enabled but numbers are not confirmed by SMS, so anyone can register with someone else\'s number.',
      evidence: ['GET /auth/v1/settings: phone_autoconfirm = true, external.phone = true'],
      impact: 'Impersonation and fake accounts.',
      fix: 'Enable phone confirmation in **Authentication > Sign In / Providers > Phone**, or disable the phone provider if unused.',
    });
  }

  if (s.disable_signup === false) {
    out.findings.push({
      checkId: 'AUTH-SIGNUP-OPEN',
      severity: 'info',
      category: 'auth',
      title: 'Anyone can create an account',
      description:
        'Public sign-up is enabled. That is normal for consumer apps, but for internal tools or invite-only products it means strangers can create accounts and reach whatever "authenticated" users can see.',
      evidence: ['GET /auth/v1/settings: disable_signup = false'],
      impact: 'If your RLS policies only check "is logged in" (`to authenticated using (true)`), every stranger who signs up gets that access.',
      fix:
        'If the app is invite-only, turn off **Allow new users to sign up**. Otherwise make sure policies check ownership (`auth.uid() = user_id`), not just being logged in, and keep the Auth rate limits and CAPTCHA enabled.',
      references: ['https://supabase.com/docs/guides/auth/rate-limits', 'https://supabase.com/docs/guides/auth/auth-captcha'],
    });
  }

  if (s.anonymous_users === true) {
    out.findings.push({
      checkId: 'AUTH-ANONYMOUS-USERS',
      severity: 'low',
      category: 'auth',
      title: 'Anonymous sign-ins are enabled',
      description:
        'Visitors can get an "authenticated" session without any email or password. Policies written for `authenticated` also apply to these anonymous users unless they check the `is_anonymous` claim.',
      evidence: ['GET /auth/v1/settings: anonymous_users = true'],
      impact: 'Policies meant for real customers may be reachable by throwaway sessions created by scripts.',
      fix: [
        'Add a restrictive policy where real accounts are required:',
        '',
        '```sql',
        'create policy "only permanent users" on public.bookings as restrictive for insert to authenticated',
        "  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false);",
        '```',
      ].join('\n'),
      references: ['https://supabase.com/docs/guides/auth/auth-anonymous'],
    });
  }

  if (enabled.length > 0) {
    out.findings.push({
      checkId: 'AUTH-PROVIDERS',
      severity: 'info',
      category: 'auth',
      title: enabled.length === 1 ? `1 sign-in method enabled` : `${enabled.length} sign-in methods enabled`,
      description: 'Every enabled sign-in method is something to secure and maintain. Disable the ones the app does not use.',
      evidence: [`Enabled providers: ${enabled.join(', ')}`],
      impact: 'Unused providers widen the attack surface (e.g. misconfigured OAuth redirect URLs).',
      fix: 'Review **Authentication > Sign In / Providers** and the allowed redirect URLs under **URL Configuration**.',
    });
  }
  return out;
}

export async function checkAuth(get: Getter): Promise<CheckOutput> {
  try {
    const res = await get('/auth/v1/settings');
    if (!res.ok || !res.body || typeof res.body !== 'object') {
      const out = emptyOutput();
      out.limitations.push(`Auth settings endpoint returned HTTP ${res.status}: ${describeError(res.body)}.`);
      return out;
    }
    const out = analyzeAuthSettings(res.body as AuthSettings);
    out.limitations.push(
      'Auth rate limits, CAPTCHA, password strength and leaked-password protection are not exposed by /auth/v1/settings and must be checked in the dashboard.',
    );
    return out;
  } catch (err) {
    const out = emptyOutput();
    out.limitations.push(`Auth settings could not be checked: ${err instanceof HttpError ? err.message : String(err)}.`);
    return out;
  }
}
