begin;

-- 妖怪が誕生した時点の名前と、現在表示する画像のファイル名を保持する。
alter table public.yokai_states
  add column if not exists yokai_name text,
  add column if not exists image_key text;

-- すでに誕生・成仏している妖怪にも、正式名と現在レベルの画像を入れる。
-- 旧版で入れた「雑務名の妖怪」は正式名へ置換するが、個別に付けた名前は維持する。
update public.yokai_states as ys
set
  yokai_name = case
    when ys.yokai_name is null or ys.yokai_name = tt.name || 'の妖怪' then
      case tt.yokai_key
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
        else tt.name || 'の妖怪'
      end
    else ys.yokai_name
  end,
  image_key = coalesce(
    ys.image_key,
    case when tt.yokai_key ~ '^Y(0[1-9]|10)$' then
      'yokai_' || tt.yokai_key || '_lv' ||
        case
          when greatest(1, ys.report_count - gs.birth_threshold + 1) >= 25 then '25'
          when greatest(1, ys.report_count - gs.birth_threshold + 1) >= 10 then '10'
          when greatest(1, ys.report_count - gs.birth_threshold + 1) >= 5 then '5'
          else '1'
        end || '.png'
    else null end
  )
from public.task_types as tt, public.guild_settings as gs
where ys.task_type_id = tt.id
  and ys.guild_id = gs.guild_id
  and ys.stage in ('active', 'ascended');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.yokai_states'::regclass
      and conname = 'yokai_states_yokai_name_check'
  ) then
    alter table public.yokai_states
      add constraint yokai_states_yokai_name_check check (
        yokai_name is null or char_length(btrim(yokai_name)) between 1 and 100
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.yokai_states'::regclass
      and conname = 'yokai_states_image_key_check'
  ) then
    alter table public.yokai_states
      add constraint yokai_states_image_key_check check (
        image_key is null
        or image_key ~ '^yokai_Y(0[1-9]|10)_lv(1|5|10|25)\.png$'
      );
  end if;
end;
$$;

commit;
