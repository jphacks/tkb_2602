begin;

-- 最後の報告から設定日数が経過した妖怪を成仏させ、通知待ちへ登録する。
-- 状態更新と通知ジョブ作成を同じトランザクションで行い、二重登録を防ぐ。
create or replace function public.process_yokai_ascensions(
  p_guild_id text,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_jobutsu_days integer;
  v_count integer;
begin
  if nullif(btrim(p_guild_id), '') is null or p_now is null then
    raise exception 'サーバーIDと判定時刻を指定してください。' using errcode = '22023';
  end if;

  -- 報告処理・設定変更と同じGuild単位のロックで直列化する。
  select jobutsu_days
    into v_jobutsu_days
  from public.guild_settings
  where guild_id = p_guild_id
  for update;

  if not found then
    raise exception 'サーバー設定が登録されていません';
  end if;
  if v_jobutsu_days is null or v_jobutsu_days < 1 then
    raise exception '成仏日数が不正です';
  end if;

  with ascended as (
    update public.yokai_states
    set
      stage = 'ascended',
      ascended_at = p_now
    where guild_id = p_guild_id
      and stage = 'active'
      and last_reported_at is not null
      and last_reported_at + make_interval(days => v_jobutsu_days) <= p_now
    returning id, guild_id, last_reported_at
  ), inserted as (
    insert into public.notification_jobs (
      event_key,
      guild_id,
      yokai_id,
      event_type
    )
    select
      id::text || ':ascend:' || last_reported_at::text,
      guild_id,
      id,
      'ascend'
    from ascended
    on conflict (event_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.process_yokai_ascensions(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_yokai_ascensions(text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
commit;
