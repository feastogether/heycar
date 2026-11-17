const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dealer=id(1),other=id(2),driver='20000000-0000-4000-8000-000000000001';
const alternateDriver='20000000-0000-4000-8000-000000000002';
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
const fixture={
 dealers:[{id:dealer,name:'亞菲得股份有限公司',partner_type:'dealer',active:true},{id:other,name:'士弘國際租賃有限公司',partner_type:'dealer',active:true}],
 vehicles:[1,2].map((n)=>({id:id(10+n),plate_no:n===1?'RFS-3203':'RFS-3204',dealer_partner_id:dealer,brand:'Toyota',model:'測試車型',current_driver_id:driver,assigned_driver_names:'測試司機',show_idle_report:true,show_maintenance_report:true,driver_history:[{driver_id:driver,driver_name:'測試司機'}],vehicle_files:[],updated_at:null})),
 fines:[],updates:[],files:[],idle:[{vehicle_id:id(11),record_date:today,drive_mins:600,idle_mins:70,mileage:300,driver_name:'測試司機'}],
 fuel:[{vehicle_id:id(11),last_fill_date:today,last_fill_mileage:100000,avg_daily_km:300}],
 policies:[{id:id(30),vehicle_id:id(11),company:'測試保險公司',insurance_type:'任意險'}],
 calendar:[{id:id(31),vehicle_id:id(11),plate_no:'RFS-3203',event_type:'maintenance',event_date:today,driver_id:driver,vendor:'測試保養廠',content:'十萬公里保養'}],
 baselines:[{id:id(40),vehicle_id:id(11),plate_no:'RFS-3203',record_type:'定期保養',service_date:today,odometer:90000,complaint:'定期保養需求',actual_work_performed:'更換機油與濾芯',total_cost:3650,tax_mode:'未稅',parts_json:[{record_type:'定期保養',part_no:'OIL-001',name:'長名稱保養用機油與濾芯測試文字',quantity:1,unit_price:3650,amount:3650}]}],
 staff_users:[{id:id(50),name:'測試夥伴',active:true,permissions:{fleetOperations:false},extension:'1234'}]
};
fixture.baselines[0].service_date=new Date(Date.parse(today)-40*86400000).toISOString().slice(0,10);
fixture.vehicles[1].current_driver_id=alternateDriver;
fixture.vehicles[1].driver_history=[];
fixture.drivers=[
 {id:driver,name:'測試司機一',dealer_partner_id:dealer,fleet_name:'亞菲得股份有限公司',driver_status:'待上線',onboarding_progress:{notes:'原始進度備註',unknown_field:'保留'},updated_at:null},
 {id:alternateDriver,name:'測試司機二',dealer_partner_id:dealer,fleet_name:'亞菲得股份有限公司',driver_status:'待上線',onboarding_progress:{notes:'原始進度備註'},updated_at:null},
 {id:'20000000-0000-4000-8000-000000000003',name:'其他車商司機',dealer_partner_id:other,driver_status:'待上線',updated_at:null}
];

module.exports={fixture,id,driver,alternateDriver,today};
