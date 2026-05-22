const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Booking = sequelize.define(
  'Booking',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Public-facing booking code. Voucher PDFs, emails, support chats all use
    // this — never expose the integer `id`.
    bookingCode: { type: DataTypes.STRING(40), allowNull: false },

    userId: { type: DataTypes.INTEGER, allowNull: false },

    // Polymorphic — which bookable model does itemId reference. The exact same
    // four types as the wishlist so the heart and the booking flow agree.
    itemType: {
      type: DataTypes.ENUM('package', 'room', 'event', 'addon'),
      allowNull: false,
    },
    itemId: { type: DataTypes.INTEGER, allowNull: false },

    // Item details at booking time. We snapshot so a later admin edit to the
    // package name / price does NOT silently change a confirmed booking or
    // its voucher.
    itemSnapshot: { type: DataTypes.JSON, allowNull: false },

    // Date the experience actually happens. For rooms this is check-in, for
    // events it's the event date, for packages/add-ons the chosen start date.
    scheduledFor: { type: DataTypes.DATEONLY, allowNull: true },
    // Only set for multi-day items (rooms with check-out, packages spanning
    // a range). Single-day add-ons / events leave this null.
    scheduledEndAt: { type: DataTypes.DATEONLY, allowNull: true },
    // Convenience: nights = end - start for rooms; days for packages.
    units: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Nights for rooms, slot count for events, days otherwise',
    },

    // Guest snapshot — denormalised so the voucher stays accurate even if the
    // user later changes their name/phone on their profile.
    guestName: { type: DataTypes.STRING(160), allowNull: false },
    guestEmail: { type: DataTypes.STRING(180), allowNull: false },
    guestPhone: { type: DataTypes.STRING(40), allowNull: false },
    guestCount: { type: DataTypes.INTEGER, defaultValue: 1 },

    specialRequests: { type: DataTypes.TEXT, allowNull: true },

    // All money is stored as integer paise (₹1 = 100 paise) to avoid float
    // drift across the booking → Cashfree → refund flow.
    currency: { type: DataTypes.STRING(8), defaultValue: 'INR' },
    unitPricePaise: { type: DataTypes.INTEGER, allowNull: false },
    subtotalPaise: { type: DataTypes.INTEGER, allowNull: false },
    taxPaise: { type: DataTypes.INTEGER, defaultValue: 0 },
    walletDiscountPaise: { type: DataTypes.INTEGER, defaultValue: 0 },
    couponDiscountPaise: { type: DataTypes.INTEGER, defaultValue: 0 },
    couponCode: { type: DataTypes.STRING(40), allowNull: true },
    totalPaise: { type: DataTypes.INTEGER, allowNull: false },

    // Lifecycle. `pending_payment` rows are created upfront so the Cashfree
    // order_id and our bookingCode line up before the user is redirected.
    status: {
      type: DataTypes.ENUM(
        'pending_payment',
        'confirmed',
        'completed',
        'cancelled',
        'refunded'
      ),
      defaultValue: 'pending_payment',
    },

    // Payment linkage — Phase 5 (Cashfree) populates these. Kept on Booking
    // for now so `My Bookings` and `Transactions` are one read away each.
    paymentOrderId: { type: DataTypes.STRING(120), allowNull: true },
    paymentId: { type: DataTypes.STRING(120), allowNull: true },
    paymentMethod: { type: DataTypes.STRING(40), allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    paymentRaw: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Last raw Cashfree payload — useful for support / refunds',
    },

    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancellationReason: { type: DataTypes.STRING(255), allowNull: true },
    refundedAt: { type: DataTypes.DATE, allowNull: true },
    refundAmountPaise: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  {
    tableName: 'bookings',
    indexes: [
      { name: 'bookings_code_unique', unique: true, fields: ['bookingCode'] },
      { fields: ['userId'] },
      { fields: ['itemType', 'itemId'] },
      { fields: ['status'] },
      { fields: ['paymentOrderId'] },
      { fields: ['scheduledFor'] },
    ],
  }
);

module.exports = Booking;
