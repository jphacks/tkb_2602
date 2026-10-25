-- 20261026_task_kind.sql → 最新の save_guild_settings・submit_report の順に適用後に実行。
-- 使い捨てのサーバーだけを操作し、最後にロールバックする。
begin;

do $test$
declare
  v_guild text := 'routine-test-' || gen_random_uuid()::text;
  v_other text := 'routine-other-' || gen_random_uuid()::text;
  v_location uuid;
  v_second_location uuid;
  v_task uuid;
  v_other_task uuid;
  v_request uuid := gen_random_uuid();
  v_abnormal_request uuid := gen_random_uuid();
  v_now timestamptz := '2030-01-02T03:04:05Z';
  v_result jsonb;
  v_before jsonb;
  v_count integer;
begin
  perform public.save_guild_settings(v_guild, '{}', array['流し', '廊下'], array['ごみ出し']);
  perform public.save_guild_settings(v_other, '{}', array['別の場所'], array['別の雑務']);
  select id into strict v_location from public.locations where guild_id = v_guild and name = '流し';
  select id into strict v_second_location from public.locations where guild_id = v_guild and name = '廊下';
  select id into strict v_task from public.task_types where guild_id = v_guild;
  select id into strict v_other_task from public.task_types where guild_id = v_other;
  if not exists (select 1 from public.task_types where id = v_task and task_kind = 'abnormal') then
    raise exception '既定の種類が従来の扱いではない';
  end if;

  update public.task_types set task_kind = 'routine' where id = v_task;
  -- 現在の設定画面から一覧を保存しても、別途指定した種類を失わない。
  perform public.save_guild_settings(v_guild, '{}', null, array['ごみ出し']);
  if not exists (select 1 from public.task_types where id = v_task and task_kind = 'routine') then
    raise exception '一覧の保存で種類が失われた';
  end if;

  v_result := public.submit_report(v_request, v_guild, v_location, v_task, 'member', v_now);
  if not (v_result @> '{
    "duplicate":false,"taskKind":"routine","points":1,"pointsAwarded":true,
    "yokaiId":null,"stage":null,"reportCount":0,"yokaiLevel":0,"guardianKey":null
  }'::jsonb) then raise exception 'いつもの仕事の初回記録に失敗: %', v_result; end if;
  if not exists (select 1 from public.reports where request_id = v_request
    and task_kind = 'routine' and created_at = v_now) then
    raise exception 'いつもの仕事の観測を保存できなかった';
  end if;
  update public.guardian_points set guardian_key = 'B' where guild_id = v_guild and member_key = 'member';

  -- 1時間たった再送でも、ポイント・クールダウンは変更しない。
  v_result := public.submit_report(v_request, v_guild, v_location, v_task, 'member', v_now + interval '1 hour');
  if not (v_result @> '{"duplicate":true,"taskKind":"routine","points":1,"pointsAwarded":false,"guardianKey":"B"}'::jsonb)
    or not exists (select 1 from public.guardian_cooldowns where guild_id = v_guild
      and member_key = 'member' and last_awarded_at = v_now)
  then raise exception '再送でポイントかクールダウンが増えた: %', v_result; end if;
  select count(*) into v_count from public.reports where guild_id = v_guild;
  if v_count <> 1 then raise exception '同じ観測を二重登録した'; end if;

  v_result := public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'member',
    v_now + interval '1 hour' - interval '1 microsecond');
  if not (v_result @> '{"duplicate":false,"points":1,"pointsAwarded":false}'::jsonb) then
    raise exception 'いつもの仕事で1時間制限が守られなかった: %', v_result;
  end if;
  v_result := public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'member', v_now + interval '1 hour');
  if not (v_result @> '{"points":2,"pointsAwarded":true,"guardianKey":"B"}'::jsonb) then
    raise exception '1時間後に再加算されなかった: %', v_result;
  end if;

  v_result := public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'other-member', v_now + interval '1 hour');
  if not (v_result @> '{"points":1,"pointsAwarded":true}'::jsonb) then
    raise exception '別の人のポイントが抑止された: %', v_result;
  end if;
  v_result := public.submit_report(gen_random_uuid(), v_guild, v_second_location, v_task, 'member', v_now + interval '1 hour');
  if not (v_result @> '{"points":3,"pointsAwarded":true}'::jsonb) then
    raise exception '別の場所のポイントが抑止された: %', v_result;
  end if;
  if exists (select 1 from public.yokai_states where guild_id = v_guild)
    or exists (select 1 from public.notification_jobs where guild_id = v_guild) then
    raise exception 'いつもの仕事から妖怪か通知が作られた';
  end if;

  -- 種類を変えても、同じ観測の再送は記録時の種類で扱う。
  update public.task_types set task_kind = 'abnormal' where id = v_task;
  v_result := public.submit_report(v_request, v_guild, v_location, v_task, 'member', v_now + interval '2 hours');
  if not (v_result @> '{"duplicate":true,"taskKind":"routine","yokaiId":null,"stage":null,"points":3}'::jsonb) then
    raise exception '種類変更後の再送が記録時の種類を使わなかった: %', v_result;
  end if;
  v_result := public.submit_report(v_abnormal_request, v_guild, v_location, v_task, 'member', v_now + interval '2 hours');
  if not (v_result @> '{"taskKind":"abnormal","stage":"presence","reportCount":1,"points":4}'::jsonb) then
    raise exception 'いつもの仕事の回数が妖怪に持ち越された: %', v_result;
  end if;
  select to_jsonb(ys) into strict v_before from public.yokai_states ys where guild_id = v_guild;
  select count(*) into v_count from public.notification_jobs where guild_id = v_guild;
  if v_count <> 1 then raise exception 'あってはいけない状態の通知が不正'; end if;

  update public.task_types set task_kind = 'routine' where id = v_task;
  v_result := public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'member', v_now + interval '3 hours');
  if not (v_result @> '{"taskKind":"routine","yokaiId":null,"stage":null,"points":5,"pointsAwarded":true}'::jsonb)
    or not exists (select 1 from public.yokai_states ys where guild_id = v_guild and to_jsonb(ys) = v_before) then
    raise exception 'いつもの仕事で既存の妖怪を変更した: %', v_result;
  end if;
  select count(*) into v_count from public.notification_jobs where guild_id = v_guild;
  if v_count <> 1 then raise exception '種類変更後のいつもの仕事から通知が作られた'; end if;
  v_result := public.submit_report(v_abnormal_request, v_guild, v_location, v_task, 'member', v_now + interval '4 hours');
  if not (v_result @> '{"duplicate":true,"taskKind":"abnormal","stage":"presence","reportCount":1,"points":5,"pointsAwarded":false}'::jsonb) then
    raise exception '過去の異常観測の再送が正しく扱われなかった: %', v_result;
  end if;

  -- 他サーバー・別内容の再送・無効な選択肢は受け付けず、途中の変更も残さない。
  begin
    perform public.submit_report(gen_random_uuid(), v_guild, v_location, v_other_task, 'member', v_now);
    raise exception '他サーバーの雑務が受理された';
  exception when raise_exception then
    if sqlerrm <> '雑務が存在しないか、無効になっています' then raise; end if;
  end;
  begin
    perform public.submit_report(v_request, v_guild, v_second_location, v_task, 'member', v_now);
    raise exception '同じrequest_idの別内容が受理された';
  exception when raise_exception then
    if sqlerrm <> 'request_idが別の報告で使用されています' then raise; end if;
  end;
  update public.task_types set is_active = false where id = v_task;
  begin
    perform public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'member', v_now);
    raise exception '無効な雑務が受理された';
  exception when raise_exception then
    if sqlerrm <> '雑務が存在しないか、無効になっています' then raise; end if;
  end;
  if exists (select 1 from public.reports where guild_id = v_other)
    or exists (select 1 from public.guardian_points where guild_id = v_other) then
    raise exception '他サーバーの記録が変更された';
  end if;

  begin
    update public.task_types set task_kind = 'unknown' where id = v_task;
    raise exception '不正な雑務の種類が保存された';
  exception when check_violation then null; end;
  begin
    update public.reports set task_kind = 'unknown' where request_id = v_request;
    raise exception '不正な観測の種類が保存された';
  exception when check_violation then null; end;
end;
$test$;

select 'テスト成功：いつもの仕事・妖怪と通知の抑止・ポイント・再送・種類変更・既存状態保持・サーバー分離・制約を確認' as result;
rollback;
