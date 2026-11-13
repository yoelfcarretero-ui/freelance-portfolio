import { HttpError, type Getter } from '../http.js';
import { describeError, emptyOutput, isPermissionDenied, type CheckOutput } from './common.js';

export interface BucketInfo {
  id: string;
  name: string;
  public: boolean;
}

const SENSITIVE_BUCKET = /(id|dni|passport|kyc|document|doc|invoice|private|contract|medical|payslip|receipt|identity|license)/i;

export async function checkStorage(get: Getter): Promise<CheckOutput & { buckets: string[] }> {
  const out = { ...emptyOutput(), buckets: [] as string[] };
  let res;
  try {
    res = await get('/storage/v1/bucket');
  } catch (err) {
    out.limitations.push(`Storage could not be checked: ${err instanceof HttpError ? err.message : String(err)}.`);
    return out;
  }

  if (!res.ok || !Array.isArray(res.body)) {
    if (isPermissionDenied(res.status, res.body) || res.status === 400) {
      out.passed.push({ category: 'storage', title: 'Bucket list is not visible to the public key', detail: `HTTP ${res.status}: ${describeError(res.body)}` });
    } else {
      out.limitations.push(`Storage bucket listing returned HTTP ${res.status}: ${describeError(res.body)}.`);
    }
    out.limitations.push('Public buckets can exist even when the bucket list is hidden. Confirm in Storage settings or with: select id, public from storage.buckets;');
    return out;
  }

  const buckets: BucketInfo[] = res.body
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => ({ id: String(b.id ?? b.name), name: String(b.name ?? b.id), public: b.public === true }));
  out.buckets = buckets.map((b) => b.name);

  if (buckets.length === 0) {
    out.passed.push({ category: 'storage', title: 'No buckets visible to the public key', detail: 'GET /storage/v1/bucket returned an empty list.' });
    out.limitations.push('An empty bucket list does not prove there are no public buckets; it may only mean anon cannot select from storage.buckets.');
    return out;
  }

  out.findings.push({
    checkId: 'STORAGE-BUCKETS-LISTABLE',
    severity: 'low',
    category: 'storage',
    title: 'Anyone can list your storage buckets',
    description: 'The public key can see the names and settings of your file storage buckets. This reveals how your app stores files.',
    evidence: [`GET /storage/v1/bucket returned ${buckets.length} bucket(s): ${buckets.map((b) => `${b.name}${b.public ? ' (public)' : ''}`).join(', ')}`],
    impact: 'Information disclosure that helps attackers target the right bucket.',
    fix: [
      'Remove any policy on `storage.buckets` that grants select to `anon` or `public`:',
      '',
      '```sql',
      "select policyname, roles, cmd from pg_policies where schemaname = 'storage' and tablename = 'buckets';",
      '-- drop policy "<policy name>" on storage.buckets;',
      '```',
    ].join('\n'),
  });

  for (const b of buckets.filter((x) => x.public)) {
    const sensitive = SENSITIVE_BUCKET.test(b.name);
    out.findings.push({
      checkId: 'STORAGE-PUBLIC-BUCKET',
      severity: sensitive ? 'critical' : 'high',
      category: 'storage',
      title: `Bucket "${b.name}" is public`,
      description:
        `Files in the public bucket "${b.name}" can be downloaded by anyone who has (or guesses) the file URL, with no login and no access rules applied. ` +
        (sensitive
          ? 'The bucket name suggests it holds private documents, which should never be public.'
          : 'This is fine for things like product images or avatars, but not for anything private.'),
      evidence: [`Bucket "${b.name}" (id: ${b.id}) has public = true.`, 'Objects were not listed or downloaded by this tool.'],
      impact: sensitive
        ? 'Exposure of identity documents or other personal files: a serious GDPR incident and a direct risk of identity fraud for your customers.'
        : 'Any file uploaded here is effectively published on the internet.',
      fix: [
        'Make the bucket private and serve files through short-lived signed URLs:',
        '',
        '```sql',
        `update storage.buckets set public = false where id = '${b.id}';`,
        '',
        `create policy "${b.name}: users read own folder"`,
        '  on storage.objects for select to authenticated',
        `  using (bucket_id = '${b.id}' and (storage.foldername(name))[1] = (select auth.uid())::text);`,
        '```',
        '',
        'In the app: `supabase.storage.from(\'' + b.name + '\').createSignedUrl(path, 60)` instead of `getPublicUrl`.',
      ].join('\n'),
      references: ['https://supabase.com/docs/guides/storage/security/access-control', 'https://supabase.com/docs/guides/storage/buckets/fundamentals'],
    });
  }

  if (!buckets.some((b) => b.public)) {
    out.passed.push({ category: 'storage', title: 'No public buckets among the listed buckets', detail: `${buckets.length} bucket(s) listed, all private.` });
  }
  return out;
}
