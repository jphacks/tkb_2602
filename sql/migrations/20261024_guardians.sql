-- 守り神：選んだ守り神と、「同じ場所×やり残されていたことは1時間に1回まで」の記録
-- submit_report.sql・reset_demo_data.sql より先に実行すること

begin;

-- 選んだ守り神（A：白狐 B：狛犬 C：水と蓮の女神 D：白蛇 E：雲の龍）。まだ選んでいなければ null（表示は白狐）
alter table public.guardian_points
  add column if not exists guardian_key text;

alter table public.guardian_points
  drop constraint if exists guardian_points_guardian_key_check;

alter table public.guardian_points
  add constraint guardian_points_guardian_key_check
  check (guardian_key is null or guardian_key in ('A', 'B', 'C', 'D', 'E'));

-- 守り神ポイントを最後にもらった時刻（人 × 場所 × やり残されていたこと ごと）
-- member_key は Discord ID を HMAC で変換した値なので、ここからも誰かはわからない
create table if not exists public.guardian_cooldowns (
  guild_id text not null,
  member_key text not null,
  location_id uuid not null,
  task_type_id uuid not null,
  last_awarded_at timestamptz not null,
  constraint guardian_cooldowns_pkey primary key (guild_id, member_key, location_id, task_type_id),
  constraint guardian_cooldowns_guild_id_fkey foreign key (guild_id) references public.guild_settings (guild_id)
);

-- ボット（service_role）以外からは読み書きできないようにする
alter table public.guardian_cooldowns enable row level security;

commit;
