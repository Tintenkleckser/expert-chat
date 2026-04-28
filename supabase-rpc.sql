create or replace function public.match_wissen_dik2(
  query_embedding vector,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  page integer,
  kategorie text,
  similarity float
)
language sql
stable
as $$
  select
    wissen_dik2.id,
    wissen_dik2.content,
    wissen_dik2.page,
    wissen_dik2.kategorie,
    1 - (wissen_dik2.embedding <=> query_embedding) as similarity
  from public.wissen_dik2
  where wissen_dik2.embedding is not null
    and wissen_dik2.content is not null
  order by wissen_dik2.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_wissen_handbuch(
  query_embedding vector,
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  category text,
  source_file text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    wissen_handbuch.id,
    wissen_handbuch.content,
    wissen_handbuch.category,
    wissen_handbuch.source_file,
    wissen_handbuch.metadata,
    1 - (wissen_handbuch.embedding <=> query_embedding) as similarity
  from public.wissen_handbuch
  where wissen_handbuch.embedding is not null
  order by wissen_handbuch.embedding <=> query_embedding
  limit match_count;
$$;
