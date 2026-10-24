-- notification_jobs の未送信判定と送信完了記録を追加する。
-- 既存行は sent_at = null のため、最初の指定時刻にまとめて通知される。

begin;

alter table public.notification_jobs
  add column if not exists sent_at timestamptz;

create index if not exists notification_jobs_pending_by_guild
  on public.notification_jobs (guild_id, id)
  where sent_at is null;

commit;
