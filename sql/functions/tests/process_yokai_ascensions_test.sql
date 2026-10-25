-- 最新の process_yokai_ascensions・submit_report・save_guild_settings を適用後に実行。
-- テスト専用のサーバーIDだけを操作し、最後に全データを取り消す（rollback）。
begin;

do $test$
declare
  v_guild text := 'weaken-test-' || gen_random_uuid()::text;
  v_location uuid;
  v_task uuid;
  v_now timestamptz := '2030-01-01T00:00:00Z';
  v_i integer;
  v_weaken integer;
  v_ascend integer;
begin
  perform public.save_guild_settings(v_guild, '{"birth_threshold":3}', array['流し'], array['洗い物']);
  update public.guild_settings set jobutsu_days = 14 where guild_id = v_guild;
  select id into strict v_location from public.locations where guild_id = v_guild;
  select id into strict v_task from public.task_types where guild_id = v_guild;

  -- 3回の観測で妖怪が生まれる
  for v_i in 1..3 loop
    perform public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'test-member', v_now);
  end loop;

  -- 6日後：成仏までの日数（14日）の半分に届かないので、何も起きない
  perform public.process_yokai_ascensions(v_guild, v_now + interval '6 days');
  select count(*) into v_weaken from public.notification_jobs where guild_id = v_guild and event_type = 'weaken';
  if v_weaken <> 0 then raise exception '半分より前に弱ってきた知らせが出た: %件', v_weaken; end if;

  -- 7日後：半分が過ぎたので、弱ってきた知らせが1件
  perform public.process_yokai_ascensions(v_guild, v_now + interval '7 days');
  -- 8日後にもう一度判定しても、二重には作らない
  perform public.process_yokai_ascensions(v_guild, v_now + interval '8 days');
  select count(*) into v_weaken from public.notification_jobs where guild_id = v_guild and event_type = 'weaken';
  if v_weaken <> 1 then raise exception '弱ってきた知らせが1件ではない: %件', v_weaken; end if;

  -- 14日後：成仏する。弱ってきた知らせは増えない
  perform public.process_yokai_ascensions(v_guild, v_now + interval '14 days');
  select count(*) filter (where event_type = 'weaken'), count(*) filter (where event_type = 'ascend')
    into v_weaken, v_ascend
  from public.notification_jobs where guild_id = v_guild;
  if v_weaken <> 1 or v_ascend <> 1 then
    raise exception '成仏のときの知らせが不正: 弱ってきた %件、成仏 %件', v_weaken, v_ascend;
  end if;
  if not exists (select 1 from public.yokai_states where guild_id = v_guild and stage = 'ascended') then
    raise exception '14日後に成仏していない';
  end if;
end;
$test$;

select 'テスト成功：半分より前は何もしない・半分で弱ってきた知らせを1回だけ・成仏のときは成仏だけ' as result;
rollback;
