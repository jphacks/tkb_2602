-- 通知時刻の正規化migrationとsave_guild_settings.sqlを適用後に実行する。
-- テストデータは最後にロールバックする。
begin;

do $test$
declare
  v_guild text := 'notification-time-test-' || gen_random_uuid()::text;
  v_configured text := 'notification-time-configured-' || gen_random_uuid()::text;
begin
  -- 時刻を省略した新規サーバーでも18:00が保存される。
  insert into public.guild_settings (guild_id) values (v_guild);
  if not exists (select 1 from public.guild_settings
    where guild_id = v_guild and notification_time = time '18:00') then
    raise exception '通知時刻の既定値が18:00ではない';
  end if;

  insert into public.guild_settings (guild_id, notification_time, notification_channel_id)
  values (v_configured, time '19:30', '111111111111111111');

  -- 他の設定だけを変更しても、指定済みの通知時刻・チャンネルを保つ。
  perform public.save_guild_settings(v_configured, '{"birth_threshold":5}');
  if not exists (select 1 from public.guild_settings where guild_id = v_configured
    and notification_time = time '19:30' and birth_threshold = 5
    and notification_channel_id = '111111111111111111') then
    raise exception '部分更新で通知時刻かチャンネルが変わった';
  end if;

  -- NOT NULLを設定した後も、通知時刻の変更は従来どおり保存できる。
  perform public.save_guild_settings(v_configured, '{"digest_hour":20}');
  if not exists (select 1 from public.guild_settings
    where guild_id = v_configured and notification_time = time '20:30') then
    raise exception '時だけを変更したときに分を保持できなかった';
  end if;
  perform public.save_guild_settings(v_configured, '{"digest_minute":0}');
  if not exists (select 1 from public.guild_settings
    where guild_id = v_configured and notification_time = time '20:00') then
    raise exception '分だけを変更したときに時を保持できなかった';
  end if;

  begin
    update public.guild_settings set notification_time = null where guild_id = v_guild;
    raise exception 'NULLへの更新を拒否しなかった';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.guild_settings (guild_id, notification_time)
    values (v_guild || '-null', null);
    raise exception '明示的なNULLの追加を拒否しなかった';
  exception when not_null_violation then null;
  end;
end;
$test$;

select 'テスト成功：通知時刻の既定値・設定保持・時刻変更・NULL拒否を確認' as result;
rollback;
