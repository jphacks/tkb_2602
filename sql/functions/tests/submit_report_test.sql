begin;

do $test$
declare
  v_guild text := 'test-' || gen_random_uuid()::text;
  v_location uuid;
  v_task uuid;
  v_request uuid := gen_random_uuid();
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
    v_request, v_guild, v_location, v_task, 'test-member'
  );

  if not (
    v_result @> '{
      "duplicate": false,
      "points": 1,
      "reportCount": 1,
      "stage": "presence"
    }'::jsonb
  ) then
    raise exception '初回報告のテストに失敗: %', v_result;
  end if;

  -- 同じrequest_idでもう一度送る
  v_result := public.submit_report(
    v_request, v_guild, v_location, v_task, 'test-member'
  );

  if not (
    v_result @> '{
      "duplicate": true,
      "points": 1,
      "reportCount": 1
    }'::jsonb
  ) then
    raise exception '二重送信のテストに失敗: %', v_result;
  end if;

  -- 別の報告を2回追加する
  for v_i in 1..2 loop
    v_result := public.submit_report(
      gen_random_uuid(),
      v_guild,
      v_location,
      v_task,
      'test-member'
    );
  end loop;

  if not (
    v_result @> '{
      "duplicate": false,
      "points": 3,
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

  -- 4回目はレベルアップとして登録される
  v_result := public.submit_report(
    gen_random_uuid(), v_guild, v_location, v_task, 'test-member'
  );

  select count(*) into v_count
  from public.notification_jobs
  where guild_id = v_guild
    and event_type = 'level_up';

  if v_count <> 1 then
    raise exception 'レベルアップの通知の件数が不正: %', v_count;
  end if;
end;
$test$;

select 'テスト成功：初回・二重送信・誕生・通知登録（気配・影・誕生・レベルアップ）を確認' as result;

rollback;