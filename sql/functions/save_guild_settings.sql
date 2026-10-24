begin;

-- 既存テーブルに通知時刻を追加。既存サーバーは18:00を引き継ぐ。
alter table public.guild_settings
  add column if not exists digest_time time without time zone not null default '18:00:00';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.guild_settings'::regclass
      and conname = 'guild_settings_digest_time_check'
  ) then
    alter table public.guild_settings
      add constraint guild_settings_digest_time_check check (
        digest_time < time '24:00:00'
        and extract(minute from digest_time) in (0, 30)
        and extract(second from digest_time) = 0
      );
  end if;
end;
$$;

create or replace function public.save_guild_settings(
  p_guild_id text,
  p_settings jsonb default '{}'::jsonb,
  p_location_names text[] default null,
  p_task_type_names text[] default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_names text[];
  v_locations text[];
  v_tasks text[];
  v_name text;
  v_yokai_key text;
  v_kind integer;
begin
  if nullif(btrim(p_guild_id), '') is null then
    raise exception 'サーバーIDを指定してください。' using errcode = '22023';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception '設定にはオブジェクトを指定してください。' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_settings) as item(key)
    where key not in ('notification_channel_id', 'admin_channel_id', 'digest_hour', 'digest_minute', 'birth_threshold')
  ) then
    raise exception '未対応の設定項目です。' using errcode = '22023';
  end if;

  foreach v_key in array array['notification_channel_id', 'admin_channel_id'] loop
    if p_settings ? v_key and p_settings -> v_key <> 'null'::jsonb then
      if jsonb_typeof(p_settings -> v_key) <> 'string'
        or p_settings ->> v_key !~ '^[0-9]{17,20}$'
      then
        raise exception 'チャンネルIDが不正です。' using errcode = '22023';
      end if;
    end if;
  end loop;
  foreach v_key in array array['digest_hour', 'digest_minute', 'birth_threshold'] loop
    if p_settings ? v_key then
      if jsonb_typeof(p_settings -> v_key) <> 'number'
        or p_settings ->> v_key !~ '^[0-9]+$'
      then
        raise exception '通知時刻または出現回数が不正です。' using errcode = '22023';
      end if;
      if (v_key = 'digest_hour' and (p_settings ->> v_key)::numeric > 23)
        or (v_key = 'digest_minute' and (p_settings ->> v_key)::numeric not in (0, 30))
        or (v_key = 'birth_threshold' and (p_settings ->> v_key)::numeric not between 1 and 2147483647)
      then
        raise exception '通知時刻または出現回数が不正です。' using errcode = '22023';
      end if;
    end if;
  end loop;

  -- 一覧の省略（null）は変更なし。空一覧による全件無効化は許可しない。
  for v_kind in 1..2 loop
    v_names := case when v_kind = 1 then p_location_names else p_task_type_names end;
    if v_names is null then continue; end if;
    if cardinality(v_names) = 0 or array_ndims(v_names) <> 1 then
      raise exception '一覧には1つ以上の名前を指定してください。' using errcode = '22023';
    end if;
    foreach v_name in array v_names loop
      if v_name is null or char_length(btrim(v_name)) not between 1 and 50
        or v_name ~ E'[\r\n]'
      then
        raise exception '名前は改行を含めず、1〜50文字で指定してください。' using errcode = '22023';
      end if;
    end loop;
    select array_agg(name order by name) into v_names
    from (select distinct btrim(item) as name from unnest(v_names) as items(item)) as normalized;
    if v_kind = 1 then v_locations := v_names; else v_tasks := v_names; end if;
  end loop;

  insert into public.guild_settings (guild_id) values (p_guild_id)
    on conflict (guild_id) do nothing;
  -- submit_reportと同じサーバー行で直列化。設定変更中の報告や同時の設定保存と競合しない。
  perform 1 from public.guild_settings where guild_id = p_guild_id for update;

  update public.guild_settings
  set
    notification_channel_id = case when p_settings ? 'notification_channel_id'
      then p_settings ->> 'notification_channel_id' else notification_channel_id end,
    admin_channel_id = case when p_settings ? 'admin_channel_id'
      then p_settings ->> 'admin_channel_id' else admin_channel_id end,
    digest_time = make_time(
      coalesce((p_settings ->> 'digest_hour')::integer, extract(hour from digest_time)::integer),
      coalesce((p_settings ->> 'digest_minute')::integer, extract(minute from digest_time)::integer),
      0
    ),
    birth_threshold = case when p_settings ? 'birth_threshold'
      then (p_settings ->> 'birth_threshold')::integer else birth_threshold end
  where guild_id = p_guild_id;

  if v_locations is not null then
    insert into public.locations (guild_id, name)
      select p_guild_id, name from unnest(v_locations) as items(name)
      on conflict (guild_id, name) do nothing;
    update public.locations set is_active = (name = any(v_locations))
      where guild_id = p_guild_id and is_active is distinct from (name = any(v_locations));
  end if;

  if v_tasks is not null then
    -- 無効な項目も含めて既存のIDと妖怪キーを維持する。
    for v_name in
      select name from unnest(v_tasks) as items(name)
      where not exists (
        select 1 from public.task_types where guild_id = p_guild_id and task_types.name = items.name
      ) order by name
    loop
      select 'Y' || lpad(n::text, 2, '0') into v_yokai_key
      from generate_series(1, 10) as slots(n)
      where not exists (
        select 1 from public.task_types
        where guild_id = p_guild_id and yokai_key = 'Y' || lpad(n::text, 2, '0')
      ) order by n limit 1;
      if not found then
        raise exception '割り当てられる妖怪（Y01〜Y10）がありません。以前の項目を再利用するか、妖怪の種類を増やしてください。'
          using errcode = '22023';
      end if;
      insert into public.task_types (guild_id, name, yokai_key)
        values (p_guild_id, v_name, v_yokai_key);
    end loop;
    update public.task_types set is_active = (name = any(v_tasks))
      where guild_id = p_guild_id and is_active is distinct from (name = any(v_tasks));
  end if;
end;
$$;

revoke all on function public.save_guild_settings(text, jsonb, text[], text[])
  from public, anon, authenticated;
grant execute on function public.save_guild_settings(text, jsonb, text[], text[])
  to service_role;

notify pgrst, 'reload schema';
commit;
