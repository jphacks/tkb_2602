-- 管理者が追加した「やり残されていたこと」のために、AI（Cloudflare Workers AI）で作った妖怪の名前と画像
-- Y01〜Y10 の決まった妖怪が合わない項目（例：紙詰まり）に、その研究室だけの妖怪を付けるため
-- AIに渡すのは、管理者が登録した項目の名前だけ（報告者の自由記述は渡さない）
-- submit_report.sql より先に実行すること

begin;

alter table public.task_types
  add column if not exists custom_yokai_name text,   -- AIが考えた妖怪の名前
  add column if not exists custom_image_key text;    -- 画像のファイル名（custom_<id>.png。assets/birth と assets/ascend に置く）

alter table public.task_types
  drop constraint if exists task_types_custom_image_key_check;

alter table public.task_types
  add constraint task_types_custom_image_key_check
  check (custom_image_key is null or custom_image_key ~ '^custom_[0-9a-f-]{36}\.png$');

commit;
