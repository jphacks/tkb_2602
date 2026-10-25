-- 初期スキーマの decay_days を、現在の成仏処理が参照する jobutsu_days に統一する。
-- process_yokai_ascensions.sql より先に実行する。
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guild_settings'
      and column_name = 'jobutsu_days'
  ) then
    -- 列名だけを変更し、既存の設定値・既定値・正数制約を引き継ぐ。
    alter table public.guild_settings rename column decay_days to jobutsu_days;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
