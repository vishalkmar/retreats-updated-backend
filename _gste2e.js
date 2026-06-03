const B = 'http://localhost:5000/api';
const j = async (r) => { const d = await r.json().catch(()=>({})); if(!r.ok) throw new Error(JSON.stringify(d)); return d; };
(async () => {
  const lg = await j(await fetch(`${B}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:'admin@traveon.com', password:'Admin@12345' })}));
  const token = lg?.data?.token || lg?.token;
  const H = { 'Content-Type':'application/json', Authorization:`Bearer ${token}` };

  // Find a room to test booking GST
  const db = require('./src/models');
  const room = await db.AvailableRoom.findOne({ where: { price: { [db.sequelize.Sequelize.Op.gt]: 0 } } });
  if (!room) { console.log('no priced room'); process.exit(0); }
  // set GST 18 on it
  await db.AvailableRoom.update({ gstRate: 18 }, { where: { id: room.id } });
  console.log(`Room #${room.id} "${room.name}" price=${room.price} gstRate set to 18`);

  // booking quote API — find the endpoint
  const quote = await j(await fetch(`${B}/bookings/quote`, { method:'POST', headers:H, body: JSON.stringify({ itemType:'room', itemId: room.id, guestCount:1, units:1, roomCount:1 }) }).catch(()=>null) || await fetch(`${B}/bookings/preview`, { method:'POST', headers:H, body: JSON.stringify({ itemType:'room', itemId: room.id, guestCount:1, units:1, roomCount:1 }) }));
  const p = quote.data?.pricing || quote.data || quote.pricing;
  console.log('taxRate:', p?.taxRate, '| gstRate:', p?.gstRate, '| subtotal:', p?.display?.subtotal, '| tax:', p?.display?.tax, '| total:', p?.display?.total);
  // reset
  await db.AvailableRoom.update({ gstRate: 0 }, { where: { id: room.id } });
  console.log('reset room gstRate to 0');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
