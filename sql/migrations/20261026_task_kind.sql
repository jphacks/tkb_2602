begin;

-- abnormal：あってはいけない状態、routine：いつもの仕事。
-- 既存の雑務・観測は従来の abnormal として扱う。
alter table public.task_types
  add column if not exists task_kind text not null default 'abnormal';

-- 雑務の種類を後から変えても、同じ観測の再送は記録時の種類で扱う。
alter table public.reports
  add column if not exists task_kind text not null default 'abnormal';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.task_types'::regclass and conname = 'task_types_task_kind_check'
  ) then
    alter table public.task_types add constraint task_types_task_kind_check
      check (task_kind in ('abnormal', 'routine'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_task_kind_check'
  ) then
    alter table public.reports add constraint reports_task_kind_check
      check (task_kind in ('abnormal', 'routine'));
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
