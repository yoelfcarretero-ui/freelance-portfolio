-- RAG chatbot schema: documents, chunks (pgvector), match_chunks() and leads.
-- Security model: RLS is enabled on every table with NO policies, so the public
-- `anon` and `authenticated` roles cannot read or write anything. Only the
-- server (Vercel functions using the service_role key) can access the data.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Source documents (one row per Markdown file and language)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  lang        text not null check (lang in ('es', 'en')),
  title       text not null,
  source_path text,
  checksum    text not null,            -- sha256 of the content, used to skip unchanged docs on re-ingest
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (slug, lang)
);

-- ---------------------------------------------------------------------------
-- Chunks with their embeddings (text-embedding-3-small = 1536 dimensions)
-- ---------------------------------------------------------------------------
create table if not exists public.chunks (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index int not null,
  section     text not null default '',
  content     text not null,
  lang        text not null check (lang in ('es', 'en')),
  embedding   extensions.vector(1536) not null,
  created_at  timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists chunks_document_id_idx on public.chunks (document_id);
create index if not exists chunks_lang_idx on public.chunks (lang);

-- HNSW index for approximate nearest-neighbour search with cosine distance.
-- (For a few thousand chunks a sequential scan is also fine; the index matters as the corpus grows.)
create index if not exists chunks_embedding_hnsw_idx
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- keep updated_at fresh on re-ingest
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Similarity search used by /api/chat in live mode
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
  match_count     int     default 4,
  filter_lang     text    default null,
  min_similarity  float   default 0.3
)
returns table (
  id             bigint,
  document_slug  text,
  document_title text,
  lang           text,
  section        text,
  chunk_index    int,
  content        text,
  similarity     float
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    d.slug  as document_slug,
    d.title as document_title,
    c.lang,
    c.section,
    c.chunk_index,
    c.content,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where (filter_lang is null or c.lang = filter_lang)
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(match_count, 20);
$$;

-- ---------------------------------------------------------------------------
-- Leads captured by the widget (contact requests / human handoff)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 100),
  email      text not null check (char_length(email) <= 254),
  phone      text check (phone is null or char_length(phone) <= 20),
  question   text not null check (char_length(question) <= 1000),
  lang       text not null default 'es' check (lang in ('es', 'en')),
  consent    boolean not null check (consent),       -- GDPR: explicit consent is required
  page_url   text,
  transcript text check (transcript is null or char_length(transcript) <= 4000),
  status     text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: on, with no policies = deny all for anon/authenticated.
-- The service_role key bypasses RLS and is only used server-side.
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;
alter table public.leads     enable row level security;

-- Defence in depth: remove direct privileges and RPC access from public roles.
revoke all on public.documents, public.chunks, public.leads from anon, authenticated;
revoke execute on function public.match_chunks(extensions.vector, int, text, float) from public, anon, authenticated;
grant execute on function public.match_chunks(extensions.vector, int, text, float) to service_role;
