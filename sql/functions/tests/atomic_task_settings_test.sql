-- 検証用DBのSQL Editorで、postgresロールとして実行する。
-- task_types.birth_thresholdのmigrationと最新のsave_guild_settings.sqlが必要。
-- 一時的な失敗注入用トリガーを含む。最後のROLLBACKでトリガーとテストデータをすべて戻す。
begin;

create function pg_temp.reject_test_threshold() returns trigger
language plpgsql as $$
begin
  if new.guild_id like 'atomic-settings-%' and new.name = '保存失敗' and new.birth_threshold = 7 then
    raise exception 'injected threshold failure' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger atomic_task_settings_test_reject
before update of birth_threshold on public.task_types
for each row execute function pg_temp.reject_test_threshold();

set local role service_role;

do $test$
declare
  v_guild text := 'atomic-settings-' || gen_random_uuid()::text;
  v_other text := 'atomic-settings-other-' || gen_random_uuid()::text;
  v_failed text := 'atomic-settings-failed-' || gen_random_uuid()::text;
  v_task uuid;
  v_key text;
  v_settings jsonb;
  v_tasks jsonb;
  v_locations jsonb;
  v_invalid jsonb;
begin
  perform public.save_guild_settings(v_guild,
    '{"birth_threshold":3,"task_birth_thresholds":{"洗い物":1,"ごみ出し":null}}',
    array['流し'], array['洗い物','ごみ出し']);
  perform public.save_guild_settings(v_other,
    '{"task_birth_thresholds":{"洗い物":9}}', null, array['洗い物']);
  select id, yokai_key into strict v_task, v_key from public.task_types
    where guild_id = v_guild and name = '洗い物';
  if not exists (select 1 from public.task_types where id = v_task and birth_threshold = 1)
    or not exists (select 1 from public.task_types where guild_id = v_guild and name = 'ごみ出し' and birth_threshold is null)
  then raise exception '新規一覧と雑務別回数を同時に保存できなかった'; end if;

  perform public.save_guild_settings(v_guild,
    '{"birth_threshold":5,"task_birth_thresholds":{"洗い物":10,"備品":2}}',
    null, array['洗い物','備品']);
  if not exists (select 1 from public.guild_settings where guild_id = v_guild and birth_threshold = 5)
    or not exists (select 1 from public.task_types where id = v_task and yokai_key = v_key and birth_threshold = 10)
    or not exists (select 1 from public.task_types where guild_id = v_guild and name = '備品' and birth_threshold = 2)
    or not exists (select 1 from public.task_types where guild_id = v_guild and name = 'ごみ出し' and not is_active)
  then raise exception '全体設定・一覧・雑務別回数の更新に失敗'; end if;

  perform public.save_guild_settings(v_guild,
    '{"task_birth_thresholds":{"洗い物":null,"備品":1}}', null, array['洗い物','備品']);
  -- 新しい項目を省略する従来の呼び出しは、個別回数を変更しない。
  perform public.save_guild_settings(v_guild, '{"birth_threshold":6}', null, array['洗い物','備品']);
  if not exists (select 1 from public.task_types where id = v_task and birth_threshold is null)
    or not exists (select 1 from public.task_types where guild_id = v_guild and name = '備品' and birth_threshold = 1)
    or not exists (select 1 from public.task_types where guild_id = v_other and birth_threshold = 9)
  then raise exception 'nullへの復帰・従来呼び出し・他サーバー分離に失敗'; end if;

  select to_jsonb(gs) into v_settings from public.guild_settings gs where guild_id = v_guild;
  select jsonb_agg(to_jsonb(tt) order by id) into v_tasks from public.task_types tt where guild_id = v_guild;
  select jsonb_agg(to_jsonb(l) order by id) into v_locations from public.locations l where guild_id = v_guild;

  for v_invalid in select value from jsonb_array_elements('[
    null, [], {}, {"洗い物":1}, {"洗い物":1,"備品":2,"別の雑務":3},
    {"洗い物":"1","備品":null}, {"洗い物":0,"備品":null},
    {"洗い物":11,"備品":null}, {"洗い物":1.5,"備品":null}, {"洗い物":true,"備品":null}
  ]'::jsonb)
  loop
    begin
      perform public.save_guild_settings(v_guild,
        jsonb_build_object('birth_threshold',9,'task_birth_thresholds',v_invalid), null, array['洗い物','備品']);
      raise exception '不正な雑務別設定を受け付けた: %', v_invalid;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.save_guild_settings(v_guild, '{"task_birth_thresholds":{"洗い物":1}}');
    raise exception '一覧を指定しない雑務別設定を受け付けた';
  exception when sqlstate '22023' then null;
  end;

  -- 入力検証の後、実際の雑務別回数のUPDATEで失敗させる。
  -- 先に変更される全体設定・場所・一覧と新規項目も、すべて元へ戻る必要がある。
  begin
    perform public.save_guild_settings(v_guild,
      '{"birth_threshold":9,"digest_hour":21,"task_birth_thresholds":{"洗い物":4,"保存失敗":7}}',
      array['失敗時の場所'], array['洗い物','保存失敗']);
    raise exception '保存途中の失敗を検出しなかった';
  exception when check_violation then
    if sqlerrm <> 'injected threshold failure' then raise; end if;
  end;
  if (select to_jsonb(gs) from public.guild_settings gs where guild_id = v_guild) is distinct from v_settings
    or (select jsonb_agg(to_jsonb(tt) order by id) from public.task_types tt where guild_id = v_guild) is distinct from v_tasks
    or (select jsonb_agg(to_jsonb(l) order by id) from public.locations l where guild_id = v_guild) is distinct from v_locations
  then raise exception '失敗後に部分保存が残った'; end if;

  begin
    perform public.save_guild_settings(v_failed,
      '{"task_birth_thresholds":{"保存失敗":7}}', array['場所'], array['保存失敗']);
    raise exception '初回保存途中の失敗を検出しなかった';
  exception when check_violation then
    if sqlerrm <> 'injected threshold failure' then raise; end if;
  end;
  if exists (select 1 from public.guild_settings where guild_id = v_failed) then
    raise exception '初回保存失敗後にサーバー設定が残った';
  end if;
end;
$test$;

select 'テスト成功：雑務別回数の同時保存・null復帰・互換性・入力検証・途中失敗の全体ロールバックを確認' as result;
rollback;
