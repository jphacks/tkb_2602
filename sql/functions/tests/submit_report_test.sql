begin;

do $test$
declare
  v_guild text := 'test-' || gen_random_uuid()::text;
  v_location uuid;
  v_task uuid;
  v_request uuid := gen_random_uuid();
  v_now timestamptz := '2030-01-02T03:04:05Z';
  v_result jsonb;
  v_count integer;
  v_i integer;
begin
  insert into public.guild_settings (
    guild_id, birth_threshold
  )
  values (v_guild, 3);

  insert into public.locations (guild_id, name)
  values (v_guild, 'テスト用キッチン')
  returning id into v_location;

  insert into public.task_types (
    guild_id, name, yokai_key
  )
  values (v_guild, 'テスト用ゴミ出し', 'Y01')
  returning id into v_task;

  -- 1回目
  v_result := public.submit_report(
    v_request, v_guild, v_location, v_task, 'test-member', v_now
  );

  if not (
    v_result @> '{
      "duplicate": false,
      "points": 1,
      "pointsAwarded": true,
      "reportCount": 1,
      "stage": "presence"
    }'::jsonb
  ) then
    raise exception '初回報告のテストに失敗: %', v_result;
  end if;

  -- 同じrequest_idでもう一度送る
  v_result := public.submit_report(
    v_request, v_guild, v_location, v_task, 'test-member', v_now
  );

  if not (
    v_result @> '{
      "duplicate": true,
      "points": 1,
      "pointsAwarded": false,
      "reportCount": 1
    }'::jsonb
  ) then
    raise exception '二重送信のテストに失敗: %', v_result;
  end if;

  -- 同時刻に別の報告を2回追加する。報告回数は増えるが、ポイントは1時間に1回まで。
  for v_i in 1..2 loop
    v_result := public.submit_report(
      gen_random_uuid(),
      v_guild,
      v_location,
      v_task,
      'test-member',
      v_now
    );
  end loop;

  if not (
    v_result @> '{
      "duplicate": false,
      "points": 1,
      "pointsAwarded": false,
      "reportCount": 3,
      "stage": "active",
      "yokaiLevel": 1
    }'::jsonb
  ) then
    raise exception '誕生判定のテストに失敗: %', v_result;
  end if;

  select count(*) into v_count
  from public.notification_jobs
  where guild_id = v_guild
    and event_type = 'birth';

  if v_count <> 1 then
    raise exception '誕生通知の件数が不正: %', v_count;
  end if;

  -- 気配（1回目）と影（2回目）も1件ずつ登録されている（二重送信の分は増えない）
  select count(*) into v_count
  from public.notification_jobs
  where guild_id = v_guild
    and event_type = 'presence';

  if v_count <> 1 then
    raise exception '気配の通知の件数が不正: %', v_count;
  end if;

  select count(*) into v_count
  from public.notification_jobs
  where guild_id = v_guild
    and event_type = 'shadow';

  if v_count <> 1 then
    raise exception '影の通知の件数が不正: %', v_count;
  end if;

  -- 4回目はレベルアップ。1時間の直前なのでポイントはまだ増えない。
  v_result := public.submit_report(
    gen_random_uuid(), v_guild, v_location, v_task, 'test-member',
    v_now + interval '1 hour' - interval '1 microsecond'
  );

  if not (v_result @> '{
    "duplicate": false, "points": 1, "pointsAwarded": false,
    "reportCount": 4, "stage": "active", "yokaiLevel": 2
  }'::jsonb) then
    raise exception '1時間未満のポイント制限のテストに失敗: %', v_result;
  end if;

  select count(*) into v_count
  from public.notification_jobs
  where guild_id = v_guild
    and event_type = 'level_up';

  if v_count <> 1 then
    raise exception 'レベルアップの通知の件数が不正: %', v_count;
  end if;

  -- 最後の加算からちょうど1時間で再加算する（直前の報告では待ち時間を延長しない）。
  v_request := gen_random_uuid();
  v_result := public.submit_report(
    v_request, v_guild, v_location, v_task, 'test-member',
    v_now + interval '1 hour'
  );

  if not (v_result @> '{
    "duplicate": false, "points": 2, "pointsAwarded": true,
    "reportCount": 5, "stage": "active", "yokaiLevel": 3
  }'::jsonb) then
    raise exception '1時間後のポイント再加算のテストに失敗: %', v_result;
  end if;

  -- さらに1時間たっても同じrequest_idの再送では加算しない。
  v_result := public.submit_report(
    v_request, v_guild, v_location, v_task, 'test-member',
    v_now + interval '2 hours'
  );

  if not (v_result @> '{
    "duplicate": true, "points": 2, "pointsAwarded": false,
    "reportCount": 5, "stage": "active", "yokaiLevel": 3
  }'::jsonb) then
    raise exception '時間経過後の二重送信のテストに失敗: %', v_result;
  end if;

  -- 再送では待ち時間を更新せず、新しい報告には加算する。
  v_result := public.submit_report(
    gen_random_uuid(), v_guild, v_location, v_task, 'test-member',
    v_now + interval '2 hours'
  );

  if not (v_result @> '{
    "duplicate": false, "points": 3, "pointsAwarded": true,
    "reportCount": 6, "stage": "active", "yokaiLevel": 4
  }'::jsonb) then
    raise exception '再送後のポイント再加算のテストに失敗: %', v_result;
  end if;
end;
$test$;

select 'テスト成功：初回・二重送信・誕生・通知登録・ポイントの1時間制限と再加算を確認' as result;

rollback;
