-- 「一覧にない」で記録された観測を、管理者が選択肢に追加するまで一時的に置いておく表
-- 管理者が追加したとき、この観測を「1回目（気配）」として数えるため
--
-- 保存するもの：どの場所・どのやり残されていたことか（一覧にない方は null）、守り神ポイント用の member_key
-- 保存しないもの：ひとことの文章（今までどおり、管理者チャンネルに届けるだけ）、報告者の Discord ID
-- reset_demo_data.sql より先に実行すること

begin;

create table if not exists public.pending_observations (
  id uuid not null default gen_random_uuid(),
  guild_id text not null,
  location_id uuid null,      -- null なら場所も「一覧にない」
  task_type_id uuid null,     -- null ならやり残されていたことも「一覧にない」
  member_key text not null,   -- Discord ID を HMAC で変換した値
  created_at timestamptz not null default now(),
  resolved_at timestamptz null, -- 管理者が追加して数えたら入る
  constraint pending_observations_pkey primary key (id),
  constraint pending_observations_guild_id_fkey foreign key (guild_id) references public.guild_settings (guild_id),
  constraint pending_observations_something_missing check (location_id is null or task_type_id is null)
);

-- ボット（service_role）以外からは読み書きできないようにする
alter table public.pending_observations enable row level security;

commit;
