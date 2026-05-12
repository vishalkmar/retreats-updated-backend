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
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CONTRACT_SENT: 'contract_sent',
  CONTRACT_SIGNED: 'contract_signed',
  COMPLETED: 'completed',
};

const FIELD_DECISION = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const ROLE = {
  AUDITOR: 'auditor',
  OFFICER: 'officer',
  OWNER: 'owner',
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
};
