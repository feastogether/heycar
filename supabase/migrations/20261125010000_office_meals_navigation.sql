-- Internal ordering is a collection workflow, not an external purchase/payment API.
create table public.office_meal_shops(
 id uuid primary key, name text not null, phone text not null default '', address text not null default '',
 menu jsonb not null default '[]', source_url text not null default '', price_note text not null default '',
 active boolean not null default true, creator text not null, revision integer not null default 1,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table public.office_meal_rounds(
 id uuid primary key, shop_id uuid not null references public.office_meal_shops(id), shop_name text not null,
 title text not null, deadline timestamptz not null, menu jsonb not null, note text not null default '',
 creator text not null, creator_name text not null, status text not null default 'open' check(status in('open','closed','cancelled')),
 revision integer not null default 1, created_at timestamptz not null default clock_timestamp()
);
create index office_meal_round_recent on public.office_meal_rounds(created_at desc,id);
create table public.office_meal_entries(
 id uuid primary key default gen_random_uuid(), round_id uuid not null references public.office_meal_rounds(id),
 actor_id text not null, actor_name text not null, items jsonb not null, note text not null default '',
 total_cents integer not null check(total_cents>=0), revision integer not null default 1,
 updated_at timestamptz not null default clock_timestamp(), unique(round_id,actor_id)
);
create table public.office_meal_audit(
 request_id uuid primary key, actor_id text not null, action text not null, shape jsonb not null,
 result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table public.office_navigation(
 id boolean primary key default true check(id), config jsonb not null default '{}', revision integer not null default 1,
 updated_at timestamptz not null default clock_timestamp(), updated_by jsonb
);
create table public.office_navigation_audit(
 id uuid primary key default gen_random_uuid(), actor jsonb not null,before_data jsonb,after_data jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.office_meal_shops enable row level security;
alter table public.office_meal_rounds enable row level security;
alter table public.office_meal_entries enable row level security;
alter table public.office_meal_audit enable row level security;
alter table public.office_navigation enable row level security;
alter table public.office_navigation_audit enable row level security;
revoke all on public.office_meal_shops,public.office_meal_rounds,public.office_meal_entries,public.office_meal_audit,public.office_navigation,public.office_navigation_audit from public,anon,authenticated;

create function public.office_meal_read(p_round uuid default null)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare chosen_round public.office_meal_rounds;begin
 if p_round is null then
  return jsonb_build_object('server_now',statement_timestamp(),
   'shops',coalesce((select jsonb_agg((to_jsonb(s)-'menu')||jsonb_build_object('menu_count',jsonb_array_length(s.menu))order by s.name)from public.office_meal_shops s where active),'[]'),
   'rounds',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(
    select r.id,r.title,r.shop_name,r.deadline,r.creator,r.creator_name,r.status,r.revision,r.created_at,
     coalesce((select sum(e.total_cents)from public.office_meal_entries e where e.round_id=r.id),0)as total_cents,
     (select count(*)from public.office_meal_entries e where e.round_id=r.id and jsonb_array_length(e.items)>0)as people
    from public.office_meal_rounds r order by r.created_at desc,r.id limit 40)x),'[]'));
 end if;
 select * into chosen_round from public.office_meal_rounds where id=p_round;
 if not found then raise exception '找不到訂購團';end if;
 return jsonb_build_object('server_now',statement_timestamp(),'round',to_jsonb(chosen_round),
  'entries',coalesce((select jsonb_agg(to_jsonb(e)order by e.actor_name,e.id)from public.office_meal_entries e where round_id=p_round),'[]'),
  'total_cents',coalesce((select sum(total_cents)from public.office_meal_entries where round_id=p_round),0),
  'summary',coalesce((select jsonb_agg(to_jsonb(x)order by x.name)from(
   select i->>'item_id'as item_id,i->>'name'as name,i->>'unit'as unit,(i->>'price_cents')::integer as price_cents,
    sum((i->>'quantity')::integer)as quantity,sum((i->>'subtotal_cents')::integer)as total_cents
   from public.office_meal_entries e cross join lateral jsonb_array_elements(e.items)i where round_id=p_round
   group by i->>'item_id',i->>'name',i->>'unit',i->>'price_cents')x),'[]'));
end;$$;

create function public.office_meal_shop(p_id uuid)returns jsonb language sql stable security definer set search_path=''as $$select to_jsonb(s)from public.office_meal_shops s where id=p_id and active$$;

create function public.office_meal_write(p_action text,p_body jsonb,p_actor jsonb,p_request uuid)returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=p_actor->>'id';prior public.office_meal_audit;shop public.office_meal_shops;
 r public.office_meal_rounds;e public.office_meal_entries;result jsonb;item jsonb;product jsonb;
 lines jsonb:='[]';total integer:=0;q integer;subtotal integer;rid uuid;begin
 if nullif(actor,'')is null or p_request is null then raise exception '缺少登入身分或操作編號';end if;
 perform pg_advisory_xact_lock(hashtextextended('meal-request:'||p_request::text,0));
 select * into prior from public.office_meal_audit where request_id=p_request;
 if found then
  if prior.actor_id<>actor or prior.action<>p_action or prior.shape is distinct from p_body then raise exception '操作編號已使用，請重新整理';end if;
  return prior.result;
 end if;
 if p_action='shop_save' then
  rid:=(p_body->>'id')::uuid;
  if nullif(btrim(p_body->>'name'),'')is null or length(p_body->>'name')>100 or length(coalesce(p_body->>'phone',''))>60 or length(coalesce(p_body->>'address',''))>300 or length(coalesce(p_body->>'price_note',''))>500 or length(coalesce(p_body->>'source_url',''))>1000 then raise exception '店家欄位格式錯誤';end if;
  if jsonb_typeof(p_body->'menu')is distinct from 'array' or jsonb_array_length(p_body->'menu')>200 or jsonb_array_length(p_body->'menu')<1 then raise exception '請填寫1至200個餐點';end if;
  for item in select x from jsonb_array_elements(p_body->'menu')x loop
   if nullif(item->>'id','')is null or length(item->>'id')>80 or nullif(btrim(item->>'name'),'')is null or length(item->>'name')>100 or coalesce(item->>'price_cents','')!~'^\d{1,7}$' or (item->>'price_cents')::integer>1000000 or length(coalesce(item->>'unit',''))>12 or length(coalesce(item->>'category',''))>40 then raise exception '餐點名稱、價格或單位不正確';end if;
  end loop;
  if(select count(distinct x->>'id')from jsonb_array_elements(p_body->'menu')x)<>jsonb_array_length(p_body->'menu')then raise exception '餐點編號不可重複';end if;
  select * into shop from public.office_meal_shops where id=rid for update;
  if found then
   if shop.creator<>actor and coalesce(p_actor->>'super','false')<>'true' then raise exception '僅建立者可編輯店家';end if;
   if shop.revision is distinct from (p_body->>'revision')::integer then raise exception '店家已更新，請重新整理';end if;
   update public.office_meal_shops set name=btrim(p_body->>'name'),phone=coalesce(p_body->>'phone',''),address=coalesce(p_body->>'address',''),menu=p_body->'menu',source_url=coalesce(p_body->>'source_url',''),price_note=coalesce(p_body->>'price_note',''),revision=revision+1,updated_at=clock_timestamp()where id=rid returning * into shop;
  else
   if coalesce((p_body->>'revision')::integer,0)<>0 then raise exception '找不到原店家，未重建';end if;
   insert into public.office_meal_shops(id,name,phone,address,menu,source_url,price_note,creator)values(rid,btrim(p_body->>'name'),coalesce(p_body->>'phone',''),coalesce(p_body->>'address',''),p_body->'menu',coalesce(p_body->>'source_url',''),coalesce(p_body->>'price_note',''),actor)returning * into shop;
  end if;result:=to_jsonb(shop);
 elsif p_action='round_create' then
  select * into shop from public.office_meal_shops where id=(p_body->>'shop_id')::uuid and active for share;
  if not found then raise exception '請選擇可用店家';end if;
  if shop.revision is distinct from (p_body->>'shop_revision')::integer then raise exception '店家菜單已更新，請重新整理並確認本次價格';end if;
  if nullif(btrim(p_body->>'title'),'')is null or length(p_body->>'title')>100 or length(coalesce(p_body->>'note',''))>1000 or (p_body->>'deadline')::timestamptz<=clock_timestamp()or(p_body->>'deadline')::timestamptz>clock_timestamp()+interval '30 days' then raise exception '請填寫團名及未來30天內的截止時間';end if;
  insert into public.office_meal_rounds(id,shop_id,shop_name,title,deadline,menu,note,creator,creator_name)values((p_body->>'id')::uuid,shop.id,shop.name,btrim(p_body->>'title'),(p_body->>'deadline')::timestamptz,shop.menu,coalesce(p_body->>'note',''),actor,p_actor->>'name')returning * into r;result:=to_jsonb(r);
 elsif p_action in('entry_save','entry_cancel','round_close','round_cancel')then
  select * into r from public.office_meal_rounds where id=(p_body->>'round_id')::uuid for update;
  if not found then raise exception '找不到訂購團';end if;
  if p_action in('round_close','round_cancel')then
   if r.creator<>actor and coalesce(p_actor->>'super','false')<>'true' then raise exception '僅發起人可管理此團';end if;
   if r.revision is distinct from (p_body->>'revision')::integer or r.status<>'open' then raise exception '此團已更新或結束';end if;
   update public.office_meal_rounds set status=case when p_action='round_cancel'then 'cancelled'else 'closed'end,revision=revision+1 where id=r.id returning * into r;result:=to_jsonb(r);
  else
   if r.status<>'open'or clock_timestamp()>=r.deadline then raise exception '已截止，餐點不可更改';end if;
   select * into e from public.office_meal_entries where round_id=r.id and actor_id=actor for update;
   if coalesce(e.revision,0) is distinct from coalesce((p_body->>'revision')::integer,0)then raise exception '你的餐點已更新，請重新整理';end if;
   if p_action='entry_cancel'then
    if e.id is null then raise exception '尚未登記餐點';end if;
    -- Retain the row/revision so a stale client cannot recreate a cancelled selection.
    update public.office_meal_entries set items='[]',note='',total_cents=0,revision=revision+1,updated_at=clock_timestamp()where id=e.id returning * into e;result:=to_jsonb(e);
   else
    if jsonb_typeof(p_body->'items')is distinct from 'array'or jsonb_array_length(p_body->'items')not between 1 and 100 or length(coalesce(p_body->>'note',''))>1000 then raise exception '請選擇餐點，備註限1000字';end if;
    if(select count(distinct x->>'item_id')from jsonb_array_elements(p_body->'items')x)<>jsonb_array_length(p_body->'items')then raise exception '同一餐點請合併數量';end if;
    for item in select x from jsonb_array_elements(p_body->'items')x loop
     if coalesce(item->>'quantity','')!~'^\d{1,3}$'or(item->>'quantity')::integer not between 1 and 200 or length(coalesce(item->>'note',''))>300 then raise exception '數量限1至200，品項備註限300字';end if;
     select x into product from jsonb_array_elements(r.menu)x where x->>'id'=item->>'item_id';
     if product is null then raise exception '餐點不在本團菜單內';end if;
     q:=(item->>'quantity')::integer;subtotal:=q*(product->>'price_cents')::integer;total:=total+subtotal;
     if total>100000000 then raise exception '訂購金額過大';end if;
     lines:=lines||jsonb_build_array(jsonb_build_object('item_id',product->>'id','name',product->>'name','unit',product->>'unit','price_cents',(product->>'price_cents')::integer,'quantity',q,'subtotal_cents',subtotal,'note',coalesce(item->>'note','')));
    end loop;
    insert into public.office_meal_entries(round_id,actor_id,actor_name,items,note,total_cents)values(r.id,actor,p_actor->>'name',lines,coalesce(p_body->>'note',''),total)
     on conflict(round_id,actor_id)do update set items=excluded.items,note=excluded.note,total_cents=excluded.total_cents,actor_name=excluded.actor_name,revision=office_meal_entries.revision+1,updated_at=clock_timestamp()returning * into e;result:=to_jsonb(e);
   end if;
  end if;
 else raise exception '不支援的訂餐操作';end if;
 insert into public.office_meal_audit(request_id,actor_id,action,shape,result)values(p_request,actor,p_action,p_body,result);
 return result;
end;$$;

create function public.office_navigation_read()returns jsonb language sql stable security definer set search_path=''as $$select coalesce((select jsonb_build_object('config',config,'revision',revision)from public.office_navigation where id),'{}'::jsonb)$$;
create function public.office_navigation_save(p_config jsonb,p_revision integer,p_actor jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$declare old public.office_navigation;updated public.office_navigation;begin
 perform pg_advisory_xact_lock(hashtextextended('office-navigation',0));select * into old from public.office_navigation where id for update;
 if coalesce(old.revision,0)is distinct from p_revision then raise exception '排序已更新，請重新整理';end if;
 insert into public.office_navigation(id,config,updated_by)values(true,p_config,p_actor)on conflict(id)do update set config=excluded.config,revision=office_navigation.revision+1,updated_at=clock_timestamp(),updated_by=excluded.updated_by returning * into updated;
 insert into public.office_navigation_audit(actor,before_data,after_data)values(p_actor,to_jsonb(old),to_jsonb(updated));
 return public.office_navigation_read();end;$$;

revoke all on function public.office_meal_shop(uuid),public.office_meal_read(uuid),public.office_meal_write(text,jsonb,jsonb,uuid),public.office_navigation_read(),public.office_navigation_save(jsonb,integer,jsonb)from public,anon,authenticated;
grant execute on function public.office_meal_read(uuid),public.office_meal_write(text,jsonb,jsonb,uuid),public.office_navigation_read(),public.office_navigation_save(jsonb,integer,jsonb)to service_role;

-- Reference prices, not a claim of branch-verified live prices. No legacy records are overwritten.
insert into public.office_meal_shops(id,name,menu,source_url,price_note,creator)values('8faf0000-0000-4000-8000-000000000001','八方雲集（台中參考菜單）',$menu$[{"id":"bf-001","name":"招牌鍋貼","price_cents":700,"unit":"顆","category":"鍋貼"},{"id":"bf-002","name":"韭菜鍋貼","price_cents":700,"unit":"顆","category":"鍋貼"},{"id":"bf-003","name":"韓式辣味鍋貼","price_cents":700,"unit":"顆","category":"鍋貼"},{"id":"bf-004","name":"咖哩雞肉鍋貼","price_cents":700,"unit":"顆","category":"鍋貼"},{"id":"bf-005","name":"玉米鍋貼","price_cents":700,"unit":"顆","category":"鍋貼"},{"id":"bf-006","name":"新蔬食鍋貼","price_cents":750,"unit":"顆","category":"鍋貼"},{"id":"bf-007","name":"招牌水餃","price_cents":700,"unit":"顆","category":"水餃"},{"id":"bf-008","name":"韭菜水餃","price_cents":700,"unit":"顆","category":"水餃"},{"id":"bf-009","name":"韓式辣味水餃","price_cents":700,"unit":"顆","category":"水餃"},{"id":"bf-010","name":"咖哩雞肉水餃","price_cents":700,"unit":"顆","category":"水餃"},{"id":"bf-011","name":"玉米水餃","price_cents":700,"unit":"顆","category":"水餃"},{"id":"bf-012","name":"新蔬食水餃","price_cents":750,"unit":"顆","category":"水餃"},{"id":"bf-013","name":"鮮蝦水餃","price_cents":1050,"unit":"顆","category":"水餃"},{"id":"bf-014","name":"酸辣湯餃（8顆）","price_cents":9000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-015","name":"玉米湯餃（8顆）","price_cents":9000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-016","name":"古早味乾麵","price_cents":4500,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-017","name":"招牌乾麵","price_cents":5500,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-018","name":"麻醬乾麵","price_cents":5500,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-019","name":"紹辣乾麵","price_cents":6000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-020","name":"古早味湯麵","price_cents":4500,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-021","name":"酸辣湯麵","price_cents":7000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-022","name":"珍珠餛飩麵","price_cents":7000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-023","name":"菜肉大餛飩麵","price_cents":8000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-024","name":"榨菜肉絲麵","price_cents":8000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-025","name":"紹辣珍珠餛飩麵","price_cents":8000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-026","name":"紹辣菜肉大餛飩麵","price_cents":9000,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-027","name":"梁師傅排骨麵","price_cents":10500,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-028","name":"紅燒牛肉麵","price_cents":16800,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-029","name":"清燉牛肉麵","price_cents":16800,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-030","name":"麻辣牛肉麵","price_cents":17800,"unit":"碗","category":"麵食／湯餃"},{"id":"bf-031","name":"珍珠和風抄手（8顆）","price_cents":6000,"unit":"份","category":"抄手"},{"id":"bf-032","name":"珍珠紅油抄手（8顆）","price_cents":6000,"unit":"份","category":"抄手"},{"id":"bf-033","name":"菜肉和風大抄手（6顆）","price_cents":7500,"unit":"份","category":"抄手"},{"id":"bf-034","name":"菜肉紅油大抄手（6顆）","price_cents":7500,"unit":"份","category":"抄手"},{"id":"bf-035","name":"酸辣湯","price_cents":3500,"unit":"碗","category":"湯品"},{"id":"bf-036","name":"玉米濃湯","price_cents":3500,"unit":"碗","category":"湯品"},{"id":"bf-037","name":"旗魚花枝丸湯","price_cents":3500,"unit":"碗","category":"湯品"},{"id":"bf-038","name":"蕈菇湯","price_cents":3500,"unit":"碗","category":"湯品"},{"id":"bf-039","name":"蘿蔔排骨湯","price_cents":3500,"unit":"碗","category":"湯品"},{"id":"bf-040","name":"珍珠餛飩湯","price_cents":5000,"unit":"碗","category":"湯品"},{"id":"bf-041","name":"菜肉大餛飩湯","price_cents":6000,"unit":"碗","category":"湯品"},{"id":"bf-042","name":"香濃豆漿","price_cents":2000,"unit":"杯","category":"飲品"},{"id":"bf-043","name":"香濃豆漿（無加糖）","price_cents":2000,"unit":"杯","category":"飲品"},{"id":"bf-044","name":"黑豆漿","price_cents":2000,"unit":"杯","category":"飲品"},{"id":"bf-045","name":"真傳特調紅茶","price_cents":2000,"unit":"杯","category":"飲品"},{"id":"bf-046","name":"寒天真傳特調紅茶","price_cents":4500,"unit":"杯","category":"飲品"},{"id":"bf-047","name":"滷蛋","price_cents":1500,"unit":"份","category":"小菜"},{"id":"bf-048","name":"皮蛋豆腐","price_cents":4500,"unit":"份","category":"小菜"},{"id":"bf-049","name":"家常小菜","price_cents":4000,"unit":"份","category":"小菜"},{"id":"bf-050","name":"小菜雙拼","price_cents":4000,"unit":"份","category":"小菜"},{"id":"bf-051","name":"柚香蘿蔔","price_cents":4000,"unit":"份","category":"小菜"},{"id":"bf-052","name":"黃金豆腐","price_cents":3500,"unit":"份","category":"小菜"},{"id":"bf-053","name":"燙青菜","price_cents":3500,"unit":"份","category":"小菜"},{"id":"bf-054","name":"燉蘿蔔","price_cents":3500,"unit":"份","category":"小菜"},{"id":"bf-055","name":"和風秋葵","price_cents":3500,"unit":"份","category":"小菜"},{"id":"bf-056","name":"薄鹽毛豆","price_cents":3500,"unit":"份","category":"小菜"},{"id":"bf-057","name":"韓式泡菜","price_cents":3000,"unit":"份","category":"小菜"},{"id":"bf-058","name":"黃金泡菜","price_cents":3000,"unit":"份","category":"小菜"},{"id":"bf-059","name":"台式泡菜","price_cents":3000,"unit":"份","category":"小菜"}]$menu$::jsonb,'https://cpok.tw/49622','2026-11-25 查詢：中部參考價格，非已核實的指定門市最新現場價；外送價不同。開團前請聯絡門市並編輯核價。品項參考八方官網，價格來源 CP值中部價目表。','super-admin');
notify pgrst,'reload schema';
