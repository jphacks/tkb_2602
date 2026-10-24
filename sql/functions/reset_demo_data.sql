-- デモ用：1つのサーバーの記録をまっさらにする
-- 消すもの：通知の予定・記録・妖怪の状態・守り神ポイント、時間のずれ（0に戻す）
-- 残すもの：サーバーの設定（チャンネル・時刻・出現回数）、場所と「やり残されていたこと」の一覧

begin;

create or replace function public.reset_demo_data(
  p_guild_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_jobs integer;
  v_reports integer;
  v_yokai integer;
  v_points integer;
begin
  if nullif(btrim(p_guild_id), '') is null then
    raise exception 'サーバーIDを指定してください';
  end if;

  -- 同じサーバーの記録と同時に動かないように、設定の行をロックする
  perform 1 from public.guild_settings where guild_id = p_guild_id for update;
  if not found then
    raise exception 'サーバー設定が登録されていません';
  end if;

  -- 通知の予定は妖怪の状態を参照しているので、先に消す
  delete from public.notification_jobs where guild_id = p_guild_id;
  get diagnostics v_jobs = row_count;

  delete from public.reports where guild_id = p_guild_id;
  get diagnostics v_reports = row_count;

  delete from public.yokai_states where guild_id = p_guild_id;
  get diagnostics v_yokai = row_count;

  delete from public.guardian_points where guild_id = p_guild_id;
  get diagnostics v_points = row_count;

  -- 守り神ポイントの「1時間に1回まで」の記録も消す（20261024_guardians.sql で作った表）
  delete from public.guardian_cooldowns where guild_id = p_guild_id;

  -- 管理者の追加待ちの観測も消す（20261024_pending_observations.sql で作った表）
  delete from public.pending_observations where guild_id = p_guild_id;

  update public.guild_settings
  set time_offset_seconds = 0
  where guild_id = p_guild_id;

  return jsonb_build_object(
    'notificationJobs', v_jobs,
    'reports', v_reports,
    'yokai', v_yokai,
    'guardianPoints', v_points
  );
end;
$$;

-- この関数はBotのサーバー側からだけ実行する
revoke all on function public.reset_demo_data(text) from public, anon, authenticated;
grant execute on function public.reset_demo_data(text) to service_role;

commit;
