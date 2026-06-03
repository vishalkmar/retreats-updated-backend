const B = 'http://localhost:5000/api';
const j = async (r) => { const d = await r.json().catch(()=>({})); if(!r.ok) throw new Error(JSON.stringify(d)); return d; };
(async () => {
  const lg = await j(await fetch(`${B}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:'admin@traveon.com', password:'Admin@12345' })}));
  const H = { 'Content-Type':'application/json', Authorization:`Bearer ${lg?.data?.token||lg?.token}` };
  let items = (await j(await fetch(`${B}/pwa/admin/listings/queue`, { headers:H }))).data.items;
  if (!items.length) items = (await j(await fetch(`${B}/pwa/admin/listings/listed`, { headers:H }))).data.items;
  let prop=null;
  for (const it of items) { const p=(await j(await fetch(`${B}/pwa/admin/listings/${it.id}`,{headers:H}))).data.property; const rooms=(p.fields||[]).find(f=>f.sectionKey==='rooms')?.deepDiveData?.rooms||[]; if(rooms.length){prop=p;break;} if(!prop)prop=p; }
  const rooms=(prop.fields||[]).find(f=>f.sectionKey==='rooms')?.deepDiveData?.rooms||[];
  const roomConfig={}; const perRoom={};
  rooms.forEach((r,i)=>{ const k=r.rid||String(i); roomConfig[k]={ price:1000, gstRate: i===0?28:null, mainImage:'',removed:[],added:[],customFields:[] }; perRoom[k]={kind:'markup',type:'percent',value:0}; });
  const cfg={ propertyType:'hotel', customType:'', markup:{mode:'per_room',kind:'markup',type:'percent',value:0,gstRate:5,perRoom}, customFields:[], gallery:{removed:[],added:[]}, roomConfig, sectionConfig:{} };
  await j(await fetch(`${B}/pwa/admin/listings/${prop.id}/config`,{method:'PUT',headers:H,body:JSON.stringify(cfg)}));
  await j(await fetch(`${B}/pwa/admin/listings/${prop.id}/publish`,{method:'POST',headers:H,body:'{}'}));
  const db=require('./src/models'); const pwa=require('./src/pwa/models');
  const conf=await pwa.PwaListingConfig.findOne({where:{propertyId:prop.id}});
  const hrooms=await db.AvailableRoom.findAll({where:{hotelId:conf.linkedId},attributes:['name','price','gstRate']});
  console.log('Published rooms (room0 should be GST 28 [override], others GST 5 [global]):');
  hrooms.forEach(r=>console.log(` ${r.name}: price=${r.price} gstRate=${r.gstRate}`));
  // cleanup: unlist
  await j(await fetch(`${B}/pwa/admin/listings/${prop.id}/unlist`,{method:'POST',headers:H,body:'{}'}));
  console.log('unlisted test property');
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
