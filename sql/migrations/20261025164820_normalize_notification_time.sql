-- save_guild_settings.sql の適用後に実行する。
-- 作成済みの notification_time にも既定値・NOT NULL を適用する。
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ALTERで取得したテーブルロックを補完・NOT NULL設定まで保持する。
alter table public.guild_settings
  alter column notification_time set default time '18:00:00';

-- 明示的に設定された通知時刻は変更しない。
update public.guild_settings
set notification_time = time '18:00:00'
where notification_time is null;

alter table public.guild_settings
  alter column notification_time set not null;

notify pgrst, 'reload schema';
commit;
