const db = require('./src/models');
const svc = require('./src/services/booking.service');
(async () => {
  const room = await db.AvailableRoom.findOne({ where: { price: { [db.sequelize.Sequelize.Op.gt]: 0 } } });
  await db.AvailableRoom.update({ gstRate: 18 }, { where: { id: room.id } });
  const item = await svc.fetchItem('room', room.id);
  console.log('fetchItem price:', item.price, '| gstRate:', item.gstRate);
  const p18 = svc.computePricing({ item, guestCount:1, units:1, roomCount:1 });
  console.log('GST 18 → subtotal:', p18.display.subtotal, 'tax:', p18.display.tax, 'total:', p18.display.total, 'taxRate:', p18.taxRate);

  await db.AvailableRoom.update({ gstRate: 0 }, { where: { id: room.id } });
  const item0 = await svc.fetchItem('room', room.id);
  const p0 = svc.computePricing({ item: item0, guestCount:1, units:1, roomCount:1 });
  console.log('GST Off → subtotal:', p0.display.subtotal, 'tax:', p0.display.tax, 'total:', p0.display.total, 'taxRate:', p0.taxRate);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
