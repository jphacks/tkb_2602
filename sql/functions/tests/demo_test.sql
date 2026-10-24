-- デモ用migration・妖怪表示情報migration・最新のsubmit_report・reset_demo_dataを適用後に実行。
-- テスト専用のサーバーIDだけを操作し、最後に全データを取り消す。
begin;

do $test$
declare
  v_guild text := 'demo-test-' || gen_random_uuid()::text;
  v_other text := 'demo-other-' || gen_random_uuid()::text;
  v_location uuid;
  v_task uuid;
  v_now timestamptz := '2030-01-02T03:04:05Z';
  v_result jsonb;
  v_i integer;
begin
  perform public.save_guild_settings(v_guild, '{"digest_hour":19,"digest_minute":30}', array['流し'], array['洗い物']);
  perform public.save_guild_settings(v_other, '{}', array['別の場所'], array['別の雑務']);
  select id into strict v_location from public.locations where guild_id = v_guild;
  select id into strict v_task from public.task_types where guild_id = v_guild;
  update public.guild_settings set time_offset_seconds = 345600 where guild_id = v_guild;

  for v_i in 1..3 loop
    v_result := public.submit_report(gen_random_uuid(), v_guild, v_location, v_task, 'test-member', v_now);
  end loop;
  if not (v_result @> '{"stage":"active","reportCount":3,"points":3,"yokaiLevel":1}'::jsonb)
  then raise exception 'デモ時刻の報告で誕生しなかった'; end if;
  if exists (select 1 from public.reports where guild_id = v_guild and created_at <> v_now)
    or not exists (select 1 from public.yokai_states where guild_id = v_guild
      and last_reported_at = v_now and born_at = v_now
      and yokai_name = 'あらいわすれ坊' and image_key = 'yokai_Y01_lv1.png')
  then raise exception 'デモ時刻と妖怪の名前・画像を同時に保存できなかった'; end if;

  -- リセット時に他サーバーを巻き込まないことも確認する。
  insert into public.guardian_points (guild_id, member_key, points) values (v_other, 'other-member', 7);
  v_result := public.reset_demo_data(v_guild);
  if not (v_result @> '{"reports":3,"yokai":1,"guardianPoints":1,"notificationJobs":3}'::jsonb)
  then raise exception 'リセットした件数が不正: %', v_result; end if;
  if exists (select 1 from public.reports where guild_id = v_guild)
    or exists (select 1 from public.yokai_states where guild_id = v_guild)
    or exists (select 1 from public.guardian_points where guild_id = v_guild)
    or exists (select 1 from public.notification_jobs where guild_id = v_guild)
  then raise exception 'リセット後に記録が残った'; end if;
  if not exists (select 1 from public.guild_settings where guild_id = v_guild
      and time_offset_seconds = 0 and notification_time = time '19:30')
    or not exists (select 1 from public.locations where id = v_location and is_active)
    or not exists (select 1 from public.task_types where id = v_task and is_active)
    or not exists (select 1 from public.guardian_points where guild_id = v_other and points = 7)
  then raise exception '設定・選択肢・他サーバーのデータが失われた'; end if;

  -- もう一度リセットしても、失敗せず0件になる。
  v_result := public.reset_demo_data(v_guild);
  if not (v_result @> '{"reports":0,"yokai":0,"guardianPoints":0,"notificationJobs":0}'::jsonb)
  then raise exception 'リセット再実行の結果が不正'; end if;
end;
$test$;

select 'テスト成功：デモ時刻・妖怪名と画像・リセット・サーバー分離・設定保持を確認' as result;
rollback;
