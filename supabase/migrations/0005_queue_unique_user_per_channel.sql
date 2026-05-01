create temporary table queue_entries_dedup as
select distinct on (channel_id, user_id)
  guild_id,
  channel_id,
  user_id,
  role,
  display_name,
  joined_at,
  duo_user_id,
  ready_check_id,
  platform,
  platform_user_id
from public.queue_entries
order by channel_id, user_id, joined_at desc;

truncate table public.queue_entries;

insert into public.queue_entries (
  guild_id,
  channel_id,
  user_id,
  role,
  display_name,
  joined_at,
  duo_user_id,
  ready_check_id,
  platform,
  platform_user_id
)
select
  guild_id,
  channel_id,
  user_id,
  role,
  display_name,
  joined_at,
  duo_user_id,
  ready_check_id,
  platform,
  platform_user_id
from queue_entries_dedup;

alter table public.queue_entries
  drop constraint if exists queue_entries_pkey;

alter table public.queue_entries
  add primary key (channel_id, user_id);

create index if not exists idx_queue_entries_channel_role_joined
  on public.queue_entries (channel_id, role, joined_at);
