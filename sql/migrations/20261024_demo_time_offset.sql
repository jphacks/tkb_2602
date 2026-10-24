-- デモで「時間を進める」ための「ずれ」を、サーバーごとに保存する列
-- アプリの中の今（getNow()）＝ 本当の今 ＋ time_offset_seconds
-- 進めるだけで、戻すときは 0 にする（マイナスにはしない）

begin;

alter table public.guild_settings
  add column if not exists time_offset_seconds bigint not null default 0;

alter table public.guild_settings
  drop constraint if exists guild_settings_time_offset_seconds_check;

alter table public.guild_settings
  add constraint guild_settings_time_offset_seconds_check
  check (time_offset_seconds >= 0);

commit;
