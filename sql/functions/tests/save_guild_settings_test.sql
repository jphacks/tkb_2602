-- save_guild_settings.sqlを適用してから実行。テストデータは最後にロールバックする。
begin;

do $test$
declare
  v_guild text := 'settings-test-' || gen_random_uuid()::text;
  v_other text := 'settings-other-' || gen_random_uuid()::text;
  v_failed text := 'settings-failed-' || gen_random_uuid()::text;
  v_mapping text;
  v_case record;
  v_location uuid;
  v_task uuid;
  v_key text;
  v_count integer;
  v_i integer;
  v_names text[];
begin
  -- 指定語は名前の途中にあっても対応する番号になる。各ケースは別サーバーで検証する。
  for v_case in
    select * from (values
      ('器具の洗い忘れ', 'Y01'),
      ('ゴミが残っていた', 'Y02'), ('ごみが残っていた', 'Y02'),
      ('器具を出しっぱなし', 'Y03'), ('器具を置きっぱなし', 'Y03'),
      ('机が散らかっていた', 'Y04'),
      ('器具の返却忘れ', 'Y05'), ('器具を戻し忘れた', 'Y05'),
      ('電気の消し忘れ', 'Y06'), ('照明の消し忘れ', 'Y06'),
      ('空調の消し忘れ', 'Y07'), ('エアコンの消し忘れ', 'Y07'),
      ('冷蔵庫の閉め忘れ', 'Y08'), ('冷凍庫の閉め忘れ', 'Y08'),
      ('床の掃除忘れ', 'Y09'), ('棚にほこりがあった', 'Y09'),
      ('消耗品の補充忘れ', 'Y10'), ('消耗品が切れていた', 'Y10'), ('備品が足りない', 'Y10')
    ) as cases(name, expected_key)
  loop
    v_mapping := 'settings-mapping-' || gen_random_uuid()::text;
    perform public.save_guild_settings(v_mapping, '{}', null, array[v_case.name]);
    select yokai_key into strict v_key from public.task_types
      where guild_id = v_mapping and name = v_case.name;
    if v_key <> v_case.expected_key then
      raise exception '名前からの割当に失敗: %（期待: %、実際: %）', v_case.name, v_case.expected_key, v_key;
    end if;
  end loop;

  -- 入力順・名前の並び順がY番号と違っていても、空いている希望番号を使う。
  v_mapping := 'settings-batch-' || gen_random_uuid()::text;
  perform public.save_guild_settings(v_mapping, '{}', null,
    array['備品が切れていた', '電気の消し忘れ', '洗い忘れ', 'ゴミ', '出しっぱなし',
      '机', '返却忘れ', '空調', '冷蔵庫', '掃除忘れ']);
  select count(*) into v_count from public.task_types
  where guild_id = v_mapping and (
    (name = '洗い忘れ' and yokai_key = 'Y01') or (name = 'ゴミ' and yokai_key = 'Y02') or
    (name = '出しっぱなし' and yokai_key = 'Y03') or (name = '机' and yokai_key = 'Y04') or
    (name = '返却忘れ' and yokai_key = 'Y05') or (name = '電気の消し忘れ' and yokai_key = 'Y06') or
    (name = '空調' and yokai_key = 'Y07') or (name = '冷蔵庫' and yokai_key = 'Y08') or
    (name = '掃除忘れ' and yokai_key = 'Y09') or (name = '備品が切れていた' and yokai_key = 'Y10')
  );
  if v_count <> 10 then raise exception '一括追加で名前に対応する番号が割り当たらなかった'; end if;

  -- 使用済みなら無効な雑務も避けて、最小の空き番号へフォールバックする。
  v_mapping := 'settings-fallback-' || gen_random_uuid()::text;
  perform public.save_guild_settings(v_mapping, '{}', null, array['電気の消し忘れ']);
  insert into public.task_types (guild_id, name, yokai_key, is_active)
    values (v_mapping, '以前の項目', 'Y01', false);
  perform public.save_guild_settings(v_mapping, '{}', null, array['照明の消し忘れ']);
  if not exists (select 1 from public.task_types
    where guild_id = v_mapping and name = '照明の消し忘れ' and yokai_key = 'Y02')
  then raise exception '使用済み番号から最小の空き番号への割当に失敗'; end if;
  perform public.save_guild_settings(v_mapping, '{}', null, array['窓の閉め忘れ']);
  if not exists (select 1 from public.task_types
    where guild_id = v_mapping and name = '窓の閉め忘れ' and yokai_key = 'Y03')
  then raise exception '該当語なしの最小の空き番号への割当に失敗'; end if;

  -- 一致語が複数なら指定順で選び、その番号が使用済みなら別の一致語ではなく空き順にする。
  v_mapping := 'settings-priority-' || gen_random_uuid()::text;
  perform public.save_guild_settings(v_mapping, '{}', null, array['備品の洗い忘れ']);
  perform public.save_guild_settings(v_mapping, '{}', null, array['机の洗い忘れ']);
  if not exists (select 1 from public.task_types
    where guild_id = v_mapping and name = '備品の洗い忘れ' and yokai_key = 'Y01')
    or not exists (select 1 from public.task_types
    where guild_id = v_mapping and name = '机の洗い忘れ' and yokai_key = 'Y02')
  then raise exception '複数の一致語の優先順かフォールバックが不正'; end if;

  -- 過去に名前と異なる番号が付いた雑務も、再保存・再有効化で変更しない。
  v_mapping := 'settings-existing-' || gen_random_uuid()::text;
  insert into public.guild_settings (guild_id) values (v_mapping);
  insert into public.task_types (guild_id, name, yokai_key, is_active)
    values (v_mapping, '備品が切れていた', 'Y04', false) returning id into v_task;
  perform public.save_guild_settings(v_mapping, '{}', null, array['備品が切れていた']);
  perform public.save_guild_settings(v_mapping, '{}', null, array['備品が切れていた']);
  if not exists (select 1 from public.task_types
    where id = v_task and yokai_key = 'Y04' and is_active)
  then raise exception '既存の雑務のIDか妖怪キーが変更された'; end if;

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

select 'テスト成功：名前別割当・空き順・既存キー保持・初回・部分更新・無効化・再有効化・サーバー分離・ロールバック・権限を確認' as result;
rollback;
