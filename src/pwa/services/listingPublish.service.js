const slugify = require('slugify');
const db = require('../../models'); // website models

const { Hotel, AvailableRoom, HotelImage, AvailableRoomImage, Package, Event } = db;

// ── helpers ────────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Apply a markup ({ type:'percent'|'fixed', value }) to a base price.
const applyMarkup = (price, mk) => {
  const p = Number(price) || 0;
  if (!mk) return p;
  const v = Number(mk.value) || 0;
  return mk.type === 'fixed' ? Math.max(0, p + v) : Math.max(0, p * (1 + v / 100));
};

// Pick the markup for a specific room: per-room override if configured, else
// the top-level "total" markup applied uniformly per room.
const roomMarkupFor = (markup, roomKey) => {
  if (markup?.mode === 'per_room' && markup.perRoom?.[roomKey]) return markup.perRoom[roomKey];
  return { type: markup?.type || 'percent', value: markup?.value || 0 };
};

const uniqueSlug = async (Model, base, scope = {}) => {
  let slug = slugify(base || 'item', { lower: true, strict: true }) || 'item';
  let candidate = slug;
  let i = 1;
  while (await Model.findOne({ where: { ...scope, slug: candidate } })) {
    candidate = `${slug}-${i++}`;
    if (i > 200) break;
  }
  return candidate;
};

const getRooms = (property) => {
  const field = (property.fields || []).find((f) => f.sectionKey === 'rooms');
  const rooms = field?.deepDiveData?.rooms;
  return Array.isArray(rooms) ? rooms : [];
};

// room.photos = { categoryKey: [url, …] } → flat list of urls.
const roomPhotos = (room) => {
  const out = [];
  Object.values(room?.photos || {}).forEach((arr) => { if (Array.isArray(arr)) out.push(...arr); });
  return out.filter(Boolean);
};

const customTextHtml = (fields) => (fields || [])
  .filter((f) => f.kind === 'text' && f.value)
  .map((f) => `<p><strong>${esc(f.name)}:</strong> ${esc(f.value)}</p>`)
  .join('');

const customImages = (fields) => (fields || [])
  .filter((f) => f.kind === 'image' && f.value)
  .map((f) => f.value);

// ── publishers ───────────────────────────────────────────────────────────

async function publishHotel(property, config) {
  const markup = config.markup || {};
  const listingImgs = (property.listingImages || []).map((li) => li.url).filter(Boolean);
  const rooms = getRooms(property);
  const firstPhoto = listingImgs[0] || (rooms.length ? roomPhotos(rooms[0])[0] : null);

  const slug = await uniqueSlug(Hotel, property.name);
  const hotel = await Hotel.create({
    name: property.name,
    slug,
    address: property.address || null,
    cityName: property.locationText || null,
    primaryImage: firstPhoto || null,
    shortDescription: property.locationText || null,
    description: customTextHtml(config.customFields) || null,
    currency: 'INR',
    isActive: true,
  });

  const galleryUrls = [...listingImgs, ...customImages(config.customFields)];
  if (galleryUrls.length) {
    await HotelImage.bulkCreate(galleryUrls.map((url, i) => ({ hotelId: hotel.id, url, sortOrder: i })));
  }

  let cheapest = null;
  for (const room of rooms) {
    const price = applyMarkup(room.price, roomMarkupFor(markup, room.rid));
    if (cheapest === null || price < cheapest) cheapest = price;
    const rslug = await uniqueSlug(AvailableRoom, room.category || 'room', { hotelId: hotel.id });
    const facHtml = Array.isArray(room.facilities) && room.facilities.length
      ? `<ul>${room.facilities.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '';
    const photos = roomPhotos(room);
    const created = await AvailableRoom.create({
      ownerType: 'hotel',
      hotelId: hotel.id,
      packageId: null,
      name: room.category || 'Room',
      slug: rslug,
      price,
      currency: 'INR',
      roomSize: room.sizeSqft ? `${room.sizeSqft} sqft` : null,
      maxOccupancy: 2,
      mainImage: photos[0] || null,
      highlightsRich: room.highlights || null,
      descriptionRich: facHtml || null,
      extraPersonTiers: Array.isArray(room.extraPersonTiers) ? room.extraPersonTiers : [],
      isActive: true,
    });
    if (photos.length) {
      await AvailableRoomImage.bulkCreate(photos.map((url, i) => ({ roomId: created.id, url, sortOrder: i })));
    }
  }

  if (cheapest !== null) {
    hotel.priceFrom = cheapest;
    await hotel.save();
  }

  return { linkedType: 'hotel', linkedId: hotel.id };
}

// Package / Event share a basic shape (no per-room model). Price = cheapest
// room with markup applied (so onboarding pricing still flows through).
async function publishSimple(property, config, kind) {
  const Model = kind === 'event' ? Event : Package;
  const markup = config.markup || {};
  const rooms = getRooms(property);
  const listingImgs = (property.listingImages || []).map((li) => li.url).filter(Boolean);
  const prices = rooms.map((r) => applyMarkup(r.price, roomMarkupFor(markup, r.rid))).filter((p) => p > 0);
  const cheapest = prices.length ? Math.min(...prices) : 0;

  const slug = await uniqueSlug(Model, property.name);
  const common = {
    name: property.name,
    slug,
    shortDescription: property.locationText || null,
    description: customTextHtml(config.customFields) || null,
    currency: 'INR',
    isActive: true,
  };
  // priceFrom exists on both Package and Event; primaryImage too.
  common.primaryImage = listingImgs[0] || (rooms.length ? roomPhotos(rooms[0])[0] : null);
  common.priceFrom = cheapest;

  const row = await Model.create(common);
  return { linkedType: kind, linkedId: row.id };
}

// Main entry — materialise the website entity from a PWA property + config.
async function publishListing(property, config) {
  const type = config.propertyType;
  if (type === 'hotel' || type === 'custom') return publishHotel(property, config);
  if (type === 'package') return publishSimple(property, config, 'package');
  if (type === 'event') return publishSimple(property, config, 'event');
  throw new Error('Pick a property type (hotel / package / event) before listing');
}

module.exports = { publishListing, applyMarkup };
