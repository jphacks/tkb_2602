-- save_guild_settings.sqlを適用してから実行。テストデータは最後にロールバックする。
begin;

do $test$
declare
  v_guild text := 'settings-test-' || gen_random_uuid()::text;
  v_other text := 'settings-other-' || gen_random_uuid()::text;
  v_failed text := 'settings-failed-' || gen_random_uuid()::text;
  v_location uuid;
  v_task uuid;
  v_key text;
  v_count integer;
  v_i integer;
  v_names text[];
begin
  -- 初回保存はサーバー行から作成する。空白・重複も正規化する。
  perform public.save_guild_settings(v_guild,
    '{"notification_channel_id":"111111111111111111","admin_channel_id":"222222222222222222","digest_hour":19,"digest_minute":30}'::jsonb,
    array[' 流し ', '流し', '会議室'], array['洗い物', 'ごみ出し']);
  if not exists (
    select 1 from public.guild_settings where guild_id = v_guild
      and notification_time = time '19:30' and birth_threshold = 3
      and notification_channel_id = '111111111111111111'
      and admin_channel_id = '222222222222222222'
  ) then raise exception '初回の設定保存に失敗'; end if;
  select count(*) into v_count from public.locations where guild_id = v_guild;
  if v_count <> 2 then raise exception '場所の正規化に失敗'; end if;
  select id into strict v_location from public.locations where guild_id = v_guild and name = '流し';
  select id, yokai_key into strict v_task, v_key from public.task_types where guild_id = v_guild and name = '洗い物';
  -- 名前を外した後も、既存の報告が参照するIDは残る。
  insert into public.reports (request_id, guild_id, location_id, task_type_id)
    values (gen_random_uuid(), v_guild, v_location, v_task);

  perform public.save_guild_settings(v_other, '{}', array['流し'], array['洗い物']);
  perform public.save_guild_settings(v_guild, '{"birth_threshold":5}', array['会議室', '廊下'], array['ごみ出し', '補充']);
  if not exists (select 1 from public.locations where id = v_location and not is_active)
    or not exists (select 1 from public.task_types where id = v_task and not is_active and yokai_key = v_key)
  then raise exception '削除せずに無効化する処理に失敗'; end if;
  if not exists (select 1 from public.guild_settings where guild_id = v_guild
    and notification_time = time '19:30' and notification_channel_id = '111111111111111111' and birth_threshold = 5)
  then raise exception '部分更新で他の設定が失われた'; end if;
  if not exists (select 1 from public.locations where guild_id = v_other and name = '流し' and is_active)
  then raise exception '他サーバーの一覧が変更された'; end if;

  perform public.save_guild_settings(v_guild, '{}', array['流し', '会議室'], array['洗い物', 'ごみ出し']);
  perform public.save_guild_settings(v_guild, '{}', array['流し', '会議室'], array['洗い物', 'ごみ出し']);
  if not exists (select 1 from public.locations where id = v_location and is_active)
    or not exists (select 1 from public.task_types where id = v_task and is_active and yokai_key = v_key)
  then raise exception '再有効化でIDか妖怪キーが変わった'; end if;
  select count(*) into v_count from public.task_types where guild_id = v_guild;
  if v_count <> 3 then raise exception '再送で雑務が重複登録された'; end if;
  if not exists (select 1 from public.reports where guild_id = v_guild
    and location_id = v_location and task_type_id = v_task)
  then raise exception '過去の報告が失われた'; end if;

  -- 時と分は片方だけ変えられる。null指定のチャンネルは解除できる。
  perform public.save_guild_settings(v_guild, '{"digest_minute":0,"notification_channel_id":null}');
  if not exists (select 1 from public.guild_settings where guild_id = v_guild
    and notification_time = time '19:00' and notification_channel_id is null and admin_channel_id = '222222222222222222')
  then raise exception '時刻・チャンネルの部分更新に失敗'; end if;

  begin
    perform public.save_guild_settings(v_guild, '{"digest_hour":24}');
    raise exception '不正な時刻が保存された';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.save_guild_settings(v_guild, '{"birth_threshold":0}');
    raise exception '不正な出現回数が保存された';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.save_guild_settings(v_guild, '{"admin_channel_id":123}');
    raise exception '不正なチャンネルIDが保存された';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.save_guild_settings(v_guild, '{}', array[]::text[]);
    raise exception '空一覧が保存された';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.save_guild_settings(v_guild, '{}', array[null]::text[]);
    raise exception 'nullの名前が保存された';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.save_guild_settings(v_guild, '{"unknown":true}');
    raise exception '未対応の設定が保存された';
  exception when sqlstate '22023' then null; end;

  -- 無効な雑務のキーも予約したままにする。割り当て不能なら設定も場所も一緒に戻す。
  for v_i in 1..10 loop
    insert into public.task_types (guild_id, name, yokai_key)
      select v_guild, '割当済み-' || v_i, 'Y' || lpad(v_i::text, 2, '0')
      where not exists (select 1 from public.task_types where guild_id = v_guild and yokai_key = 'Y' || lpad(v_i::text, 2, '0'));
  end loop;
  begin
    perform public.save_guild_settings(v_guild, '{"digest_hour":21,"birth_threshold":9}', array['失敗時に残ってはいけない場所'], array['新規雑務']);
    raise exception '妖怪キーの不足が検出されなかった';
  exception when sqlstate '22023' then null; end;
  if not exists (select 1 from public.guild_settings where guild_id = v_guild and notification_time = time '19:00' and birth_threshold = 5)
    or exists (select 1 from public.locations where guild_id = v_guild and name = '失敗時に残ってはいけない場所')
    or not exists (select 1 from public.locations where id = v_location and is_active)
  then raise exception '保存途中の失敗がロールバックされなかった'; end if;

  select array_agg('雑務-' || n) into v_names from generate_series(1, 11) as items(n);
  begin
    perform public.save_guild_settings(v_failed, '{}', array['場所'], v_names);
    raise exception '初回保存の失敗が検出されなかった';
  exception when sqlstate '22023' then null; end;
  if exists (select 1 from public.guild_settings where guild_id = v_failed)
  then raise exception '初回保存の失敗後にサーバー行が残った'; end if;

  if has_function_privilege('anon', 'public.save_guild_settings(text,jsonb,text[],text[])', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.save_guild_settings(text,jsonb,text[],text[])', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.save_guild_settings(text,jsonb,text[],text[])', 'EXECUTE')
  then raise exception '関数の実行権限が不正'; end if;
end;
$test$;

select 'テスト成功：初回・部分更新・無効化・再有効化・サーバー分離・割当・ロールバック・権限を確認' as result;
rollback;
