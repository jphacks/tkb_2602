-- yokai_states.image_key に、AIで作った妖怪の画像（custom_<項目のID>.png）も入れられるようにする
-- 20261024_yokai_identity.sql の yokai_states_image_key_check を広げる（20261024_custom_yokai.sql のあとに実行）

begin;

alter table public.yokai_states
  drop constraint if exists yokai_states_image_key_check;

alter table public.yokai_states
  add constraint yokai_states_image_key_check check (
    image_key is null
    or image_key ~ '^yokai_Y(0[1-9]|10)_lv(1|5|10|25)\.png$'
    or image_key ~ '^custom_[0-9a-f-]{36}\.png$'
  );

commit;
