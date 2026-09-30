/**
 * The setup SQL of PLAN §4.7.3, verbatim: what "Copy setup SQL" puts on the clipboard and what the README's
 * "Set up sync" shows. It creates the one generic table `forge_rows` with row-level security, the
 * last-write-wins trigger (an older write never replaces a newer one, a clock far ahead is capped at
 * five minutes, `seq` follows commit order) and `forge_now()`. It is safe to run again.
 *
 * Do not edit this text on its own: `setupSql.test.ts` compares it with PLAN.md (and with the README once
 * that has a "Set up sync" section), so the SQL a person copies is the SQL that was verified.
 */
export const SETUP_SQL = `-- Forge cloud sync: run once in your Supabase project's SQL editor. Safe to run again.
-- One table holds every synced Forge row as JSON. Row-level security keeps each account's rows private.

create table if not exists public.forge_rows (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  tbl            text        not null check (char_length(tbl) between 1 and 64),
  id             text        not null check (char_length(id) between 1 and 200),
  updated_at     bigint      not null,  -- last-write-wins stamp: ms since 1970, from the device that wrote it
  device_id      text        not null check (char_length(device_id) between 1 and 64),
  deleted        boolean     not null default false,  -- a tombstone: the row was deleted
  schema_version integer     not null check (schema_version > 0),
  data           jsonb,                  -- the Forge row; null once deleted
  seq            bigint      not null default 0,  -- change cursor, set by the trigger below
  modified_at    timestamptz not null default now(),  -- server time of the last accepted write
  primary key (user_id, tbl, id),
  constraint forge_rows_data_check check (deleted or data is not null)
);

create sequence if not exists public.forge_rows_seq;

create index if not exists forge_rows_user_seq on public.forge_rows (user_id, seq);

-- Every write goes through here: an older write never replaces a newer one, a clock that runs far
-- ahead cannot win for long, and \`seq\` follows commit order so a pull never misses a row.
create or replace function public.forge_rows_accept()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A stamp more than five minutes ahead of the server is capped there.
  new.updated_at := least(
    new.updated_at,
    (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000
  );
  if tg_op = 'UPDATE' then
    -- Last write wins. Equal stamps go to the larger device id, so every device agrees.
    if (new.updated_at, new.device_id) < (old.updated_at, old.device_id) then
      return null;  -- keep the stored row
    end if;
  end if;
  -- One writer per account at a time: \`seq\` is handed out in commit order.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.seq := nextval('public.forge_rows_seq');
  new.modified_at := now();
  if new.deleted then
    new.data := null;
  end if;
  return new;
end;
$$;

drop trigger if exists forge_rows_accept on public.forge_rows;
create trigger forge_rows_accept
  before insert or update on public.forge_rows
  for each row execute function public.forge_rows_accept();

-- The server's clock, so Forge can tell you when a device's clock is off.
create or replace function public.forge_now()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select (extract(epoch from now()) * 1000)::bigint;
$$;

alter table public.forge_rows enable row level security;

drop policy if exists forge_rows_select on public.forge_rows;
create policy forge_rows_select on public.forge_rows
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists forge_rows_insert on public.forge_rows;
create policy forge_rows_insert on public.forge_rows
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists forge_rows_update on public.forge_rows;
create policy forge_rows_update on public.forge_rows
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists forge_rows_delete on public.forge_rows;
create policy forge_rows_delete on public.forge_rows
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.forge_rows from anon;
revoke all on sequence public.forge_rows_seq from anon;
revoke all on function public.forge_now() from anon, public;
grant select, insert, update, delete on table public.forge_rows to authenticated;
grant usage on sequence public.forge_rows_seq to authenticated;
grant execute on function public.forge_now() to authenticated;
`
