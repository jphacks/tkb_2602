-- 読み取り専用。通知時刻の定義・NULL件数と、設定保持の照合用ハッシュを表示する。
-- 適用前の expected_settings_hash と、適用後の settings_hash が一致すれば、
-- NULLを18:00にする以外のサーバー設定は変わっていない。
begin read only;
set local timezone = 'UTC';

select
  c.column_default,
  c.is_nullable,
  (select count(*) from public.guild_settings) as guild_count,
  (select count(*) from public.guild_settings where notification_time is null) as null_time_count,
  (select md5(coalesce(jsonb_agg(to_jsonb(gs) order by guild_id), '[]'::jsonb)::text)
    from public.guild_settings gs) as settings_hash,
  (select md5(coalesce(jsonb_agg(
      to_jsonb(gs) || jsonb_build_object('notification_time', coalesce(notification_time, time '18:00:00'))
      order by guild_id), '[]'::jsonb)::text)
    from public.guild_settings gs) as expected_settings_hash
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'guild_settings'
  and c.column_name = 'notification_time';

rollback;
