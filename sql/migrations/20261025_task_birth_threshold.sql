begin;

-- 雑務ごとの「何回目で妖怪が出現するか」。
-- null のときは、サーバー全体の値（guild_settings.birth_threshold）を使う。
-- 例：器具の洗い忘れのように1回でも困るものは 1、出しっぱなしのように続くと困るものは null（全体の値）。
alter table public.task_types
  add column if not exists birth_threshold integer;

alter table public.task_types
  drop constraint if exists task_types_birth_threshold_check;

alter table public.task_types
  add constraint task_types_birth_threshold_check
  check (birth_threshold is null or birth_threshold between 1 and 10);

commit;
