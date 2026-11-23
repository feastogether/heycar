-- Cell presentation is independent of leave, maintenance and driver assignments.
alter table public.driver_roster_notes add column color text not null default '' check(color='' or color ~ '^#[0-9A-Fa-f]{6}$');
create function public.driver_roster_save_color(p_driver uuid,p_date date,p_note text,p_color text,p_revision integer,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.driver_roster_notes;result public.driver_roster_notes;begin
 if p_date is null or length(coalesce(p_note,''))>1000 or p_revision is null or p_revision<0 or p_color is null or (p_color<>'' and p_color !~ '^#[0-9A-Fa-f]{6}$') then raise exception '班表備註或顏色格式錯誤';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text||p_date::text,0));
 select * into old from public.driver_roster_notes where driver_id=p_driver and work_on=p_date for update;
 if coalesce(old.revision,0)<>p_revision then raise exception '此格已更新，請重新整理後編輯';end if;
 insert into public.driver_roster_notes(driver_id,work_on,note,color,revision,updated_by)values(p_driver,p_date,trim(coalesce(p_note,'')),lower(p_color),p_revision+1,p_actor)on conflict(driver_id,work_on)do update set note=excluded.note,color=excluded.color,revision=excluded.revision,updated_by=p_actor,updated_at=clock_timestamp() returning * into result;
 insert into public.driver_roster_note_audit(driver_id,work_on,before_data,after_data,actor)values(p_driver,p_date,to_jsonb(old),to_jsonb(result),p_actor);return to_jsonb(result);end;$$;
revoke all on function public.driver_roster_save_color(uuid,date,text,text,integer,jsonb)from public,anon,authenticated;
grant execute on function public.driver_roster_save_color(uuid,date,text,text,integer,jsonb)to service_role;
notify pgrst,'reload schema';
