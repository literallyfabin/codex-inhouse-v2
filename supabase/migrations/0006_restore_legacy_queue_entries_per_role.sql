alter table public.queue_entries
  drop constraint if exists queue_entries_pkey;

alter table public.queue_entries
  add primary key (channel_id, user_id, role);

create index if not exists idx_queue_entries_channel_role_joined
  on public.queue_entries (channel_id, role, joined_at);
