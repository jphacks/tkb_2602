-- 新規DBで一度だけ実行する。既存DBへの更新には migrations/ と functions/ を使う。
begin;

-- 1. Discordサーバーごとの設定
create table public.guild_settings (
  guild_id text primary key,
  notification_channel_id text,
  admin_channel_id text,
  admin_role_id text,
  birth_threshold integer not null default 3
    check (birth_threshold > 0),
  decay_days integer not null default 14
    check (decay_days > 0),
  timezone text not null default 'Asia/Tokyo',
  created_at timestamptz not null default now()
);

-- 2. 場所の選択肢
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guild_settings(guild_id),
  name text not null,
  is_active boolean not null default true,
  unique (guild_id, name),
  unique (guild_id, id)
);

-- 3. 雑務の選択肢
create table public.task_types (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guild_settings(guild_id),
  name text not null,
  yokai_key text not null,
  is_active boolean not null default true,
  unique (guild_id, name),
  unique (guild_id, id)
);

-- 4. 報告履歴：報告者IDと自由記述は保存しない
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  guild_id text not null references public.guild_settings(guild_id),
  location_id uuid not null,
  task_type_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (guild_id, location_id)
    references public.locations(guild_id, id),
  foreign key (guild_id, task_type_id)
    references public.task_types(guild_id, id)
);

-- 5. 場所×雑務ごとの妖怪の状態
create table public.yokai_states (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guild_settings(guild_id),
  location_id uuid not null,
  task_type_id uuid not null,
  report_count integer not null default 0
    check (report_count >= 0),
  stage text not null default 'presence'
    check (stage in ('presence', 'shadow', 'active', 'ascended')),
  last_reported_at timestamptz,
  born_at timestamptz,
  ascended_at timestamptz,
  unique (guild_id, location_id, task_type_id),
  unique (guild_id, id),
  foreign key (guild_id, location_id)
    references public.locations(guild_id, id),
  foreign key (guild_id, task_type_id)
    references public.task_types(guild_id, id)
);

-- 6. 本人用の守り神ポイント
create table public.guardian_points (
  guild_id text not null references public.guild_settings(guild_id),
  member_key text not null,
  points integer not null default 0 check (points >= 0),
  primary key (guild_id, member_key)
);

-- 7. 通知の送信待ち・送信結果
create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  guild_id text not null references public.guild_settings(guild_id),
  yokai_id uuid not null,
  event_type text not null
    check (event_type in ('birth', 'level_up', 'weaken', 'ascend')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  discord_message_id text,
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (guild_id, yokai_id)
    references public.yokai_states(guild_id, id)
);

-- よく使う検索用のインデックス
create index reports_by_pattern
  on public.reports
  (guild_id, location_id, task_type_id, created_at desc);

create index notifications_to_send
  on public.notification_jobs (status, next_attempt_at);

-- 一般利用者からの直接アクセスを防ぐ
alter table public.guild_settings enable row level security;
alter table public.locations enable row level security;
alter table public.task_types enable row level security;
alter table public.reports enable row level security;
alter table public.yokai_states enable row level security;
alter table public.guardian_points enable row level security;
alter table public.notification_jobs enable row level security;

commit;
