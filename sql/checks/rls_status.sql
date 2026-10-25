-- publicスキーマの各テーブルでRLSが有効か確認する（参照のみ）。
select
  tablename as table_name,
  rowsecurity as rls_enabled
from pg_catalog.pg_tables
where schemaname = 'public'
order by tablename;
