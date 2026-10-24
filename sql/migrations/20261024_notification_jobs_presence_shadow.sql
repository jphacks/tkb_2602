-- notification_jobs に「気配（presence）」「影（shadow）」も登録できるようにする
-- 毎日のまとめ通知で「今日の気配の数・影の数」を出すため。
-- submit_report.sql より先に実行すること（関数が presence / shadow を登録するので）

begin;

alter table public.notification_jobs
  drop constraint notification_jobs_event_type_check;

alter table public.notification_jobs
  add constraint notification_jobs_event_type_check
  check (
    event_type = any (
      array[
        'presence'::text,
        'shadow'::text,
        'birth'::text,
        'level_up'::text,
        'weaken'::text,
        'ascend'::text
      ]
    )
  );

commit;
