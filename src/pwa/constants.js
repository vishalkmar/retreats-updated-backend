// Shared constants for the PWA audit flow.
// SECTION_KEYS define the 8 sections an Auditor must capture in Phase 3.
// Property STATUS values track the full lifecycle from draft through
// contract-signed. Keep the order — frontend reads it for pipeline UIs.

const SECTION_KEYS = [
  { key: 'entrance', label: 'Entrance & Facade', required: true },
  { key: 'reception', label: 'Reception & Common Area', required: true },
  { key: 'rooms', label: 'Rooms & Washrooms (>50%)', required: true },
  { key: 'kitchen', label: 'Kitchen & Food', required: true },
  { key: 'cctv', label: 'CCTV (if available)', required: false },
  { key: 'facilities', label: 'Facilities', required: true },
  { key: 'garden', label: 'Garden Area (if available)', required: false },
  { key: 'meditation', label: 'Meditation / Activity Room', required: true },
  { key: 'trainer', label: 'Trainer Name & Certificate', required: true },
];

const SECTION_KEY_SET = new Set(SECTION_KEYS.map((s) => s.key));

const PROPERTY_STATUS = {
  DRAFT: 'draft',
  PHASE1_DONE: 'phase1_done',
  PHASE3_SUBMITTED: 'phase3_submitted',
  IN_REVIEW: 'in_review',
  IN_REVISION: 'in_revision',
  // After Phase 3 officer approval. Conceptually "semi-approved" — the
  // structural audit is done but the CRM-style deep-dive (Phase 4) still
  // needs to be filled in by the auditor and re-approved by the officer.
  APPROVED: 'approved',
  // Phase 4 lifecycle.
  PHASE4_SUBMITTED: 'phase4_submitted',
  PHASE4_IN_REVISION: 'phase4_in_revision',
  // Final state — Phase 4 reviewed and accepted. Triggers contract PDF
  // generation; from here the auditor releases the contract to the owner.
  FINAL_APPROVED: 'final_approved',
  REJECTED: 'rejected',
  CONTRACT_SENT: 'contract_sent',
  CONTRACT_SIGNED: 'contract_signed',
  COMPLETED: 'completed',
};

// CRM-style deep-dive field catalogue for Phase 4. The frontend renders a
// form from this schema and the backend whitelists incoming keys against it
// so users can't slip arbitrary fields into the JSON blob.
//
// Field types:
//   text      — single-line string
//   textarea  — multi-line string
//   number    — integer
//   bool      — checkbox
//   select    — single select; `options` required
//   multi     — multi-select; `options` required
//   time      — HH:mm
const PHASE4_SCHEMA = {
  entrance: [
    { key: 'hasGate',         label: 'Property has a gate',         type: 'bool' },
    { key: 'gateMaterial',    label: 'Gate material',               type: 'text' },
    { key: 'parkingSpaces',   label: 'Parking spaces',              type: 'number' },
    { key: 'parkingType',     label: 'Parking type',                type: 'select', options: ['Outdoor', 'Covered', 'Basement', 'Street'] },
    { key: 'entranceLighting',label: 'Entrance lighting',           type: 'text' },
    { key: 'guardOnDuty',     label: 'Security guard on duty',      type: 'bool' },
    { key: 'guardShifts',     label: 'Guard shifts (e.g. 24x7)',    type: 'text' },
  ],
  reception: [
    { key: 'counterMaterial',     label: 'Counter material',                type: 'text' },
    { key: 'seatingCapacity',     label: 'Reception seating capacity',      type: 'number' },
    { key: 'waitingArea',         label: 'Has dedicated waiting area',      type: 'bool' },
    { key: 'refreshmentsAvailable', label: 'Refreshments at reception',     type: 'bool' },
    { key: 'hoursOpen',           label: 'Reception hours',                 type: 'text' },
    { key: 'languagesSpoken',     label: 'Languages spoken',                type: 'multi', options: ['English', 'Hindi', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'Punjabi', 'French', 'Spanish', 'German'] },
    { key: 'checkInTime',         label: 'Check-in time',                   type: 'time' },
    { key: 'checkOutTime',        label: 'Check-out time',                  type: 'time' },
  ],
  rooms: [
    { key: 'totalRooms',          label: 'Total rooms',                     type: 'number' },
    { key: 'roomTypes',           label: 'Room types offered',              type: 'multi', options: ['Standard', 'Deluxe', 'Premium', 'Suite', 'Family', 'Dorm'] },
    { key: 'avgRoomSizeSqft',     label: 'Average room size (sq ft)',       type: 'number' },
    { key: 'avgRoomLengthFt',     label: 'Average room length (ft)',        type: 'number' },
    { key: 'avgRoomWidthFt',      label: 'Average room width (ft)',         type: 'number' },
    { key: 'bedTypes',            label: 'Bed types',                       type: 'multi', options: ['Single', 'Twin', 'Double', 'Queen', 'King'] },
    { key: 'washroomType',        label: 'Washroom type',                   type: 'select', options: ['En-suite', 'Shared', 'Mixed'] },
    { key: 'hotWater',            label: 'Hot water available 24/7',        type: 'bool' },
    { key: 'acAvailable',         label: 'A/C available',                   type: 'bool' },
    { key: 'heaterAvailable',     label: 'Heater available',                type: 'bool' },
    { key: 'wifiInRooms',         label: 'Wi-Fi in rooms',                  type: 'bool' },
    { key: 'housekeepingFrequency', label: 'Housekeeping frequency',        type: 'select', options: ['Daily', 'Alternate', 'On request', 'None'] },
  ],
  kitchen: [
    { key: 'cuisineTypes',        label: 'Cuisine types',                   type: 'multi', options: ['Indian', 'Continental', 'Sattvic', 'Vegan', 'Ayurvedic', 'Chinese', 'Italian', 'South Indian', 'North Indian'] },
    { key: 'mealPlansOffered',    label: 'Meal plans offered',              type: 'multi', options: ['Breakfast only', 'Half board', 'Full board', 'All inclusive'] },
    { key: 'capacityPerSitting',  label: 'Dining capacity per sitting',     type: 'number' },
    { key: 'prepStaffCount',      label: '# of kitchen staff',              type: 'number' },
    { key: 'hygieneCertificateNo',label: 'Hygiene certificate / FSSAI #',   type: 'text' },
    { key: 'specialDietsServed',  label: 'Special diets served',            type: 'multi', options: ['Vegan', 'Gluten-free', 'Jain', 'Nut-free', 'Diabetic-friendly', 'Low-sodium'] },
    { key: 'waterSource',         label: 'Drinking water source',           type: 'text' },
    { key: 'kitchenSizeSqft',     label: 'Kitchen size (sq ft)',            type: 'number' },
  ],
  cctv: [
    { key: 'totalCameras',        label: 'Total cameras installed',         type: 'number' },
    { key: 'coverageAreas',       label: 'Coverage areas',                  type: 'multi', options: ['Entrance', 'Reception', 'Parking', 'Corridors', 'Garden', 'Kitchen', 'Common areas'] },
    { key: 'recordingRetentionDays', label: 'Recording retention (days)',   type: 'number' },
    { key: 'monitoringCenterPresent', label: 'Live monitoring center',      type: 'bool' },
    { key: 'nightVision',         label: 'Night vision capable',            type: 'bool' },
  ],
  facilities: [
    { key: 'poolPresent',         label: 'Swimming pool',                   type: 'bool' },
    { key: 'poolType',            label: 'Pool type',                       type: 'select', options: ['Outdoor', 'Indoor', 'Heated', 'Children only', 'Infinity'] },
    { key: 'poolLengthM',         label: 'Pool length (m)',                 type: 'number' },
    { key: 'spaPresent',          label: 'Spa',                             type: 'bool' },
    { key: 'gymPresent',          label: 'Gym',                             type: 'bool' },
    { key: 'gymAreaSqft',         label: 'Gym area (sq ft)',                type: 'number' },
    { key: 'yogaShalaPresent',    label: 'Yoga shala / deck',               type: 'bool' },
    { key: 'yogaShalaCapacity',   label: 'Yoga shala capacity (people)',    type: 'number' },
    { key: 'wifiPresent',         label: 'Wi-Fi in common areas',           type: 'bool' },
    { key: 'wifiSpeedMbps',       label: 'Wi-Fi speed (Mbps)',              type: 'number' },
  ],
  garden: [
    { key: 'gardenAreaSqft',      label: 'Garden area (sq ft)',             type: 'number' },
    { key: 'plantTypes',          label: 'Plant types',                     type: 'textarea' },
    { key: 'organicGarden',       label: 'Organic garden',                  type: 'bool' },
    { key: 'sittingZones',        label: '# of sitting zones',              type: 'number' },
    { key: 'kidsPlayArea',        label: 'Kids play area',                  type: 'bool' },
    { key: 'gardenerOnStaff',     label: 'Gardener on staff',               type: 'bool' },
  ],
  meditation: [
    { key: 'roomCapacity',        label: 'Capacity (people)',               type: 'number' },
    { key: 'matsProvided',        label: 'Yoga mats provided',              type: 'bool' },
    { key: 'soundSystem',         label: 'Sound system available',          type: 'bool' },
    { key: 'ambianceType',        label: 'Ambiance type',                   type: 'text' },
    { key: 'naturalLight',        label: 'Natural light',                   type: 'bool' },
    { key: 'ceilingHeightFt',     label: 'Ceiling height (ft)',             type: 'number' },
  ],
  trainer: [
    { key: 'yearsOfExperience',   label: 'Years of experience',             type: 'number' },
    { key: 'certificationBody',   label: 'Certification body',              type: 'text' },
    { key: 'certificationNumber', label: 'Certification number',            type: 'text' },
    { key: 'specialties',         label: 'Specialties',                     type: 'multi', options: ['Hatha Yoga', 'Vinyasa', 'Ashtanga', 'Iyengar', 'Pranayama', 'Meditation', 'Reiki', 'Sound healing', 'Naturopathy', 'Ayurveda'] },
    { key: 'maxClassSize',        label: 'Maximum class size',              type: 'number' },
    { key: 'languagesTaught',     label: 'Languages taught',                type: 'multi', options: ['English', 'Hindi', 'Sanskrit', 'Tamil', 'Telugu', 'Marathi', 'Bengali'] },
  ],
};

// Build a normalized lookup for validation: { sectionKey: Set<fieldKey> }
const PHASE4_FIELD_KEYS = Object.fromEntries(
  Object.entries(PHASE4_SCHEMA).map(([k, fields]) => [k, new Set(fields.map((f) => f.key))]),
);

const FIELD_DECISION = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const ROLE = {
  AUDITOR: 'auditor',
  OFFICER: 'officer',
  OWNER: 'owner',
  SALESPERSON: 'salesperson',
};

const OTP_PURPOSE = {
  SIGNUP_VERIFY: 'signup_verify',
  LOGIN: 'login',
  RESET: 'reset',
  OWNER_LOGIN: 'owner_login',
};

module.exports = {
  SECTION_KEYS,
  SECTION_KEY_SET,
  PROPERTY_STATUS,
  FIELD_DECISION,
  ROLE,
  OTP_PURPOSE,
  PHASE4_SCHEMA,
  PHASE4_FIELD_KEYS,
};
