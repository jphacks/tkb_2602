begin;

-- 先に sql/migrations/20261026_task_kind.sql を適用する。
-- 引数を足したので、古い形（5つの引数）の関数を消してから作り直す（両方あると呼び分けられなくなるため）
drop function if exists public.submit_report(uuid, text, uuid, uuid, text);

create or replace function public.submit_report(
  p_request_id uuid,
  p_guild_id text,
  p_location_id uuid,
  p_task_type_id uuid,
  p_member_key text,
  -- アプリの中の「今」（getNow()）。デモで時間を進めたときのため。省略したら本当の今
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_threshold integer;
  v_report_id uuid;
  v_state public.yokai_states%rowtype;
  v_points integer;
  v_stage text;
  v_event_type text;
  v_duplicate boolean;
  v_level integer;
  v_task_name text;
  v_task_kind text;
  -- 雑務ごとの出現回数（20261025_task_birth_threshold.sql）。null ならサーバー全体の値を使う
  v_task_threshold integer;
  -- 管理者が追加した項目のために、AIで作った妖怪（20261024_custom_yokai.sql）。なければ null
  v_custom_name text;
  v_custom_image text;
  v_yokai_key text;
  -- 守り神ポイント：同じ場所×やり残されていたことは1時間に1回まで
  v_last_awarded timestamptz;
  v_awarded boolean := false;
  v_guardian_key text;
  v_now timestamptz := coalesce(p_now, now());
begin
  -- 必須項目の確認
  if p_request_id is null
    or nullif(btrim(p_guild_id), '') is null
    or p_location_id is null
    or p_task_type_id is null
    or nullif(btrim(p_member_key), '') is null
  then
    raise exception '必須項目が不足しています';
  end if;

  -- 同じサーバーの報告を順番に処理する
  select birth_threshold
    into v_threshold
  from public.guild_settings
  where guild_id = p_guild_id
  for update;

  if not found then
    raise exception 'サーバー設定が登録されていません';
  end if;

  -- 場所がこのサーバーの有効な選択肢か確認
  perform 1
  from public.locations
  where id = p_location_id
    and guild_id = p_guild_id
    and is_active = true;

  if not found then
    raise exception '場所が存在しないか、無効になっています';
  end if;

  -- 雑務がこのサーバーの有効な選択肢か確認
  select name, yokai_key, custom_yokai_name, custom_image_key, birth_threshold, task_kind
    into v_task_name, v_yokai_key, v_custom_name, v_custom_image, v_task_threshold, v_task_kind
  from public.task_types
  where id = p_task_type_id
    and guild_id = p_guild_id
    and is_active = true;

  if not found then
    raise exception '雑務が存在しないか、無効になっています';
  end if;

  -- この雑務だけの出現回数があれば、それを使う
  v_threshold := coalesce(v_task_threshold, v_threshold);

  -- 同じrequest_idは一度しか保存しない
  insert into public.reports (
    request_id,
    guild_id,
    location_id,
    task_type_id,
    task_kind,
    created_at
  )
  values (
    p_request_id,
    p_guild_id,
    p_location_id,
    p_task_type_id,
    v_task_kind,
    v_now
  )
  on conflict (request_id) do nothing
  returning id into v_report_id;

  v_duplicate := v_report_id is null;

  if v_duplicate then
    -- 同じIDを別の内容に使い回していないか確認
    select task_kind into v_task_kind
    from public.reports
    where request_id = p_request_id
      and guild_id = p_guild_id
      and location_id = p_location_id
      and task_type_id = p_task_type_id;

    if not found then
      raise exception 'request_idが別の報告で使用されています';
    end if;

    -- いつもの仕事には妖怪の行がない。再送も記録時の種類で分岐する。
    if v_task_kind = 'abnormal' then
      select *
        into v_state
      from public.yokai_states
      where guild_id = p_guild_id
        and location_id = p_location_id
        and task_type_id = p_task_type_id;

      if not found then
        raise exception '報告に対応する妖怪の状態がありません';
      end if;
    end if;

    select points
      into v_points
    from public.guardian_points
    where guild_id = p_guild_id
      and member_key = p_member_key;

    v_points := coalesce(v_points, 0);

  else
    -- いつもの仕事は観測とポイントだけ保存し、妖怪の作成・更新を行わない。
    if v_task_kind = 'abnormal' then
      -- 初回は作成、既存なら報告回数を1増やす
      insert into public.yokai_states as ys (
        guild_id,
        location_id,
        task_type_id,
        report_count,
        last_reported_at
      )
      values (
        p_guild_id,
        p_location_id,
        p_task_type_id,
        1,
        v_now
      )
      on conflict (guild_id, location_id, task_type_id)
      do update set
        report_count = ys.report_count + 1,
        last_reported_at = excluded.last_reported_at
      returning * into v_state;

      -- 報告回数から状態を決める
      v_stage := case
        when v_state.report_count >= v_threshold then 'active'
        when v_state.report_count = 1 then 'presence'
        else 'shadow'
      end;

      -- まとめ通知に載せる出来事を決める
      -- 気配・影も登録する（まとめ通知では数だけを出す）
      -- ※ v_state はまだ更新前なので、stage と born_at は「この記録の前」の状態
      v_event_type := case
        when v_stage = 'presence' then 'presence'
        when v_stage = 'shadow' then 'shadow'
        when v_state.born_at is null
          or v_state.stage = 'ascended'
          then 'birth'
        else 'level_up'
      end;

      -- 誕生をレベル1として計算し、表示する画像の段階を決める。
      v_level := greatest(0, v_state.report_count - v_threshold + 1);

      update public.yokai_states
      set
        stage = v_stage,
        born_at = case
          when v_stage = 'active'
            then coalesce(born_at, v_now)
          else born_at
        end,
        ascended_at = null,
        yokai_name = case
          when v_stage = 'active'
            and (yokai_name is null or yokai_name = v_task_name || 'の妖怪')
            and v_custom_name is not null
            then v_custom_name
          when v_stage = 'active'
            and (yokai_name is null or yokai_name = v_task_name || 'の妖怪')
            then case v_yokai_key
              when 'Y01' then 'あらいわすれ坊'
              when 'Y02' then 'ゴミため坊'
              when 'Y03' then 'おきっぱ小僧'
              when 'Y04' then 'つくえふさぎ'
              when 'Y05' then 'もどらずピペット'
              when 'Y06' then 'あかり喰い'
              when 'Y07' then 'ふきっぱ風神'
              when 'Y08' then 'ひえひえ忘れん坊'
              when 'Y09' then 'ほこりもくもく'
              when 'Y10' then 'からっぽ狸'
              else v_task_name || 'の妖怪'
            end
          else yokai_name
        end,
        image_key = case
          -- AIで作った妖怪は、どのレベルでも同じ画像
          when v_stage = 'active' and v_custom_image is not null then v_custom_image
          when v_stage = 'active' and v_yokai_key ~ '^Y(0[1-9]|10)$' then
            'yokai_' || v_yokai_key || '_lv' ||
            case
              when v_level >= 25 then '25'
              when v_level >= 10 then '10'
              when v_level >= 5 then '5'
              else '1'
            end || '.png'
          else image_key
        end
      where id = v_state.id
      returning * into v_state;
    end if;

    -- 本人の守り神ポイントを1増やす（同じ場所×やり残されていたことは、最後にもらってから1時間たっていれば）
    select last_awarded_at
      into v_last_awarded
    from public.guardian_cooldowns
    where guild_id = p_guild_id
      and member_key = p_member_key
      and location_id = p_location_id
      and task_type_id = p_task_type_id
    for update;

    v_awarded := v_last_awarded is null or v_last_awarded <= v_now - interval '1 hour';

    if v_awarded then
      insert into public.guardian_points as gp (
        guild_id,
        member_key,
        points
      )
      values (
        p_guild_id,
        p_member_key,
        1
      )
      on conflict (guild_id, member_key)
      do update set
        points = gp.points + 1
      returning points into v_points;

      insert into public.guardian_cooldowns as gc (
        guild_id, member_key, location_id, task_type_id, last_awarded_at
      )
      values (
        p_guild_id, p_member_key, p_location_id, p_task_type_id, v_now
      )
      on conflict (guild_id, member_key, location_id, task_type_id)
      do update set
        last_awarded_at = excluded.last_awarded_at;
    else
      select points
        into v_points
      from public.guardian_points
      where guild_id = p_guild_id
        and member_key = p_member_key;

      v_points := coalesce(v_points, 0);
    end if;

    -- Discordへ送る内容を送信待ちとして登録する
    if v_event_type is not null then
      insert into public.notification_jobs (
        event_key,
        guild_id,
        yokai_id,
        event_type
      )
      values (
        v_state.id::text
          || ':' || v_event_type
          || ':' || v_state.report_count::text,
        p_guild_id,
        v_state.id,
        v_event_type
      )
      on conflict (event_key) do nothing;
    end if;
  end if;

  -- 再送時はまだ計算していないため、現在の状態から求める。
  if v_task_kind = 'routine' then
    v_level := 0;
  elsif v_duplicate then
    v_level := greatest(0, v_state.report_count - v_threshold + 1);
  end if;

  -- 選んだ守り神（まだ選んでいなければ null）
  select guardian_key
    into v_guardian_key
  from public.guardian_points
  where guild_id = p_guild_id
    and member_key = p_member_key;

  return jsonb_build_object(
    'duplicate', v_duplicate,
    'points', v_points,
    'pointsAwarded', v_awarded,
    'guardianKey', v_guardian_key,
    'taskKind', v_task_kind,
    'yokaiId', v_state.id,
    'reportCount', coalesce(v_state.report_count, 0),
    'stage', v_state.stage,
    'yokaiLevel', v_level
  );
end;
$$;

-- この関数はBotのサーバー側からだけ実行する
revoke all on function public.submit_report(
  uuid, text, uuid, uuid, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.submit_report(
  uuid, text, uuid, uuid, text, timestamptz
) to service_role;

commit;
