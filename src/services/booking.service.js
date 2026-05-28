const crypto = require('crypto');
const {
  Package,
  AvailableRoom,
  Hotel,
  Event,
  EventType,
  AddOnActivity,
  Location,
  City,
  Booking,
} = require('../models');

const TAX_RATE = Number(process.env.BOOKING_TAX_RATE || 0.18); // 18% GST default
const ALLOWED_TYPES = ['package', 'room', 'event', 'addon'];

const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const fromPaise = (paise) => Number(paise || 0) / 100;

const generateBookingCode = async () => {
  // RBT-YYYY-XXXXXX (X = uppercase hex). Loop on the (extremely unlikely)
  // collision so we never write two bookings with the same public code.
  const year = new Date().getFullYear();
  for (let i = 0; i < 6; i++) {
    const tail = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `RBT-${year}-${tail}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Booking.findOne({ where: { bookingCode: code }, attributes: ['id'] });
    if (!exists) return code;
  }
  return `RBT-${year}-${Date.now().toString(36).toUpperCase()}`;
};

// Fetch the bookable item in a uniform shape. Returns null for missing/inactive
// items so the controller can return a clean 404.
const fetchItem = async (type, id) => {
  if (!ALLOWED_TYPES.includes(type)) return null;
  const numId = parseInt(id, 10);
  if (!Number.isInteger(numId) || numId <= 0) return null;

  if (type === 'package') {
    const pkg = await Package.findByPk(numId, {
      include: [
        { model: City, as: 'city', attributes: ['id', 'name'] },
        { model: Location, as: 'location', attributes: ['id', 'name'] },
      ],
    });
    if (!pkg || pkg.isActive === false) return null;
    const j = pkg.toJSON();
    return {
      type: 'package',
      id: j.id,
      name: j.name,
      slug: j.slug,
      image: j.primaryImage,
      price: Number(j.priceFrom || 0),
      priceOriginal: j.priceOriginal ? Number(j.priceOriginal) : null,
      currency: j.currency || 'INR',
      location: j.location?.name || j.city?.name || j.locationDetail || null,
      detailHref: `/retreats/${j.slug}`,
      meta: {
        durationDays: j.durationDays,
        durationNights: j.durationNights,
        minGroupSize: j.minGroupSize,
        maxGroupSize: j.maxGroupSize,
        startDate: j.startDate,
        endDate: j.endDate,
        availableAllYear: !!j.availableAllYear,
      },
    };
  }

  if (type === 'room') {
    const room = await AvailableRoom.findByPk(numId, {
      include: [
        {
          model: Hotel,
          as: 'hotel',
          attributes: ['id', 'name', 'slug'],
          include: [
            { model: Location, as: 'location', attributes: ['id', 'name'] },
            { model: City, as: 'city', attributes: ['id', 'name'] },
          ],
        },
      ],
    });
    if (!room || room.isActive === false) return null;
    const j = room.toJSON();
    return {
      type: 'room',
      id: j.id,
      name: j.name,
      slug: j.slug,
      image: j.mainImage,
      price: Number(j.price || 0),
      priceOriginal: j.priceOriginal ? Number(j.priceOriginal) : null,
      currency: j.currency || 'INR',
      location: j.hotel?.location?.name || j.hotel?.city?.name || null,
      hotel: j.hotel ? { id: j.hotel.id, name: j.hotel.name, slug: j.hotel.slug } : null,
      detailHref: j.hotel?.slug ? `/hotels/${j.hotel.slug}/rooms/${j.slug}` : null,
      meta: {
        roomSize: j.roomSize,
        maxOccupancy: j.maxOccupancy,
      },
    };
  }

  if (type === 'event') {
    const event = await Event.findByPk(numId, {
      include: [
        { model: EventType, as: 'eventType', attributes: ['id', 'name', 'isSport'] },
        { model: Location, as: 'location', attributes: ['id', 'name'] },
      ],
    });
    if (!event || event.isActive === false) return null;
    const j = event.toJSON();
    return {
      type: 'event',
      id: j.id,
      name: j.name,
      slug: j.slug,
      image: j.mainImage,
      price: Number(j.price || 0),
      priceOriginal: j.priceOriginal ? Number(j.priceOriginal) : null,
      currency: j.currency || 'INR',
      location: j.location?.name || null,
      detailHref: `/events/${j.slug}`,
      meta: {
        eventDate: j.eventDate,
        startTime: j.startTime,
        endTime: j.endTime,
        eventTypeName: j.eventType?.name,
        isSport: !!j.eventType?.isSport,
        minAge: j.minAge,
        maxAge: j.maxAge,
      },
    };
  }

  if (type === 'addon') {
    const addon = await AddOnActivity.findByPk(numId, {
      include: [{ model: Location, as: 'location', attributes: ['id', 'name'] }],
    });
    if (!addon || addon.isActive === false) return null;
    const j = addon.toJSON();
    return {
      type: 'addon',
      id: j.id,
      name: j.name,
      slug: j.slug,
      image: j.mainImage,
      price: Number(j.price || 0),
      priceOriginal: j.priceOriginal ? Number(j.priceOriginal) : null,
      currency: j.currency || 'INR',
      location: j.location?.name || null,
      detailHref: `/add-ons/${j.slug}`,
      meta: {
        minAge: j.minAge,
        maxAge: j.maxAge,
      },
    };
  }

  return null;
};

// Compute the pricing breakdown for a given item + booking inputs. All math
// is in paise so we never lose a rupee to float rounding.
const computePricing = ({
  item,
  guestCount = 1,
  units = 1,
  roomCount = 1,
  walletPaise = 0,
  couponDiscountPaise = 0,
}) => {
  const unitPricePaise = toPaise(item.price);

  // Logic per type:
  //   room  → unitPrice × nights × roomCount  (per room, per night — like MMT)
  //   event → unitPrice × ticket count (guestCount)
  //   package, addon → unitPrice × guests (per person)
  let quantity;
  if (item.type === 'room') {
    const nights = Math.max(1, Number(units || 1));
    const rooms = Math.max(1, Number(roomCount || 1));
    quantity = nights * rooms;
  } else {
    quantity = Math.max(1, Number(guestCount || 1));
  }

  const subtotalPaise = unitPricePaise * quantity;
  const taxPaise = Math.round(subtotalPaise * TAX_RATE);

  // Discounts are applied after tax (matches MMT's display). Clamp so we
  // never go below zero — defensive in case a coupon overshoots.
  const grossPaise = subtotalPaise + taxPaise;
  const walletDiscountPaise = Math.min(Math.max(0, Number(walletPaise || 0)), grossPaise);
  const remaining = grossPaise - walletDiscountPaise;
  const safeCoupon = Math.min(Math.max(0, Number(couponDiscountPaise || 0)), remaining);
  const totalPaise = grossPaise - walletDiscountPaise - safeCoupon;

  return {
    quantity,
    currency: item.currency || 'INR',
    unitPricePaise,
    subtotalPaise,
    taxPaise,
    taxRate: TAX_RATE,
    walletDiscountPaise,
    couponDiscountPaise: safeCoupon,
    totalPaise,
    display: {
      unitPrice: fromPaise(unitPricePaise),
      subtotal: fromPaise(subtotalPaise),
      tax: fromPaise(taxPaise),
      walletDiscount: fromPaise(walletDiscountPaise),
      couponDiscount: fromPaise(safeCoupon),
      total: fromPaise(totalPaise),
    },
  };
};

// Build the canonical item snapshot we persist on the Booking row. The fields
// we save are exactly what the voucher / details modal needs to render later,
// fully independent of the source row.
const buildItemSnapshot = (item) => ({
  type: item.type,
  id: item.id,
  name: item.name,
  slug: item.slug,
  image: item.image,
  location: item.location,
  detailHref: item.detailHref,
  hotel: item.hotel || null,
  meta: item.meta || {},
  pricedAt: { price: item.price, currency: item.currency || 'INR' },
});

// Compute units & sensible defaults given user-supplied dates. Pure function —
// callers feed it the raw input, get back canonical scheduledFor / units.
const resolveSchedule = ({ item, scheduledFor, scheduledEndAt }) => {
  // Event dates are locked to the event row — ignore client input.
  if (item.type === 'event') {
    return {
      scheduledFor: item.meta?.eventDate || scheduledFor || null,
      scheduledEndAt: null,
      units: 1,
    };
  }

  // Rooms always need a check-in AND check-out so units (nights) is positive.
  if (item.type === 'room') {
    const start = scheduledFor ? new Date(scheduledFor) : null;
    const end = scheduledEndAt ? new Date(scheduledEndAt) : null;
    let nights = 1;
    if (start && end) {
      const ms = end.getTime() - start.getTime();
      nights = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
    }
    return {
      scheduledFor: scheduledFor || null,
      scheduledEndAt: scheduledEndAt || null,
      units: nights,
    };
  }

  // Packages span durationDays; default end if user gave a start but no end.
  if (item.type === 'package') {
    let end = scheduledEndAt;
    if (!end && scheduledFor && item.meta?.durationDays) {
      const d = new Date(scheduledFor);
      d.setDate(d.getDate() + Math.max(0, (item.meta.durationDays || 1) - 1));
      end = d.toISOString().slice(0, 10);
    }
    return {
      scheduledFor: scheduledFor || null,
      scheduledEndAt: end || null,
      units: item.meta?.durationDays || 1,
    };
  }

  // Add-ons are single-day experiences.
  return {
    scheduledFor: scheduledFor || null,
    scheduledEndAt: null,
    units: 1,
  };
};

module.exports = {
  ALLOWED_TYPES,
  TAX_RATE,
  fetchItem,
  computePricing,
  buildItemSnapshot,
  resolveSchedule,
  generateBookingCode,
  toPaise,
  fromPaise,
};
