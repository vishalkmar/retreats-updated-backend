const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Minimal but readable contract PDF. Produced in-memory and returned as a
// Buffer so we can both email it as an attachment and (optionally) cache
// the URL on the Contract row. Keep this file dependency-free w.r.t. our
// models so it can be reused outside the request lifecycle.

// pdf-lib's StandardFonts (Helvetica etc.) are WinAnsi-only — they throw
// when asked to render a codepoint outside Windows-1252 (e.g. Devanagari).
// We sanitize incoming strings up-front: decompose accents, strip combining
// marks, then drop any remaining non-Latin1 codepoint. Hindi/Tamil/etc.
// content disappears with a single bracketed placeholder so the rest of
// the contract still renders. (Upgrade path: install @pdf-lib/fontkit and
// embed Noto Sans + Noto Sans Devanagari for proper multi-script support.)
// Windows-1252 maps these typographic codepoints into its 0x80-0x9F range,
// so pdf-lib's WinAnsi encoder accepts them. We must NOT strip them.
const WIN1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

const sanitizeText = (raw) => {
  if (raw === null || raw === undefined) return '';
  // NFKD then strip combining marks — turns `é` into plain `e` so accents
  // that aren't in Latin-1 don't blow up either.
  const str = String(raw).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let out = '';
  let droppedRun = false;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isPrintableAscii = code >= 0x20 && code <= 0x7e;
    const isLatin1Supplement = code >= 0xa0 && code <= 0xff;
    const isWhitespaceCtrl = code === 0x09 || code === 0x0a || code === 0x0d;
    if (
      isPrintableAscii ||
      isLatin1Supplement ||
      isWhitespaceCtrl ||
      WIN1252_EXTRA.has(code)
    ) {
      out += ch;
      droppedRun = false;
    } else if (!droppedRun) {
      // Collapse any run of un-encodable chars into a single placeholder
      // so an entire Hindi address doesn't become `???????????`.
      out += '?';
      droppedRun = true;
    }
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
};

const drawWrapped = (page, text, opts) => {
  const { x, y, font, size, maxWidth, lineHeight, color } = opts;
  const safe = sanitizeText(text);
  const words = safe.split(/\s+/).filter(Boolean);
  let line = '';
  let cursorY = y;
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    const width = font.widthOfTextAtSize(trial, size);
    if (width > maxWidth) {
      page.drawText(line, { x, y: cursorY, font, size, color });
      cursorY -= lineHeight;
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) {
    page.drawText(line, { x, y: cursorY, font, size, color });
    cursorY -= lineHeight;
  }
  return cursorY;
};

// Single-line variant: drops to drawWrapped if the caller passes wrappable
// content via drawWrapped already, but for one-shot draws we still need to
// sanitize input so non-WinAnsi codepoints don't blow up.
const safeDrawText = (page, text, opts) => {
  page.drawText(sanitizeText(text), opts);
};

const generateContractPdf = async ({ property, auditor, officerName }) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.06, 0.46, 0.43);
  const slate = rgb(0.23, 0.24, 0.28);

  // Header band
  page.drawRectangle({ x: 0, y: 790, width: 595, height: 52, color: teal });
  safeDrawText(page, 'Retreats by Traveon', { x: 36, y: 808, font: helvBold, size: 18, color: rgb(1, 1, 1) });
  safeDrawText(page, 'Property Onboarding Contract', { x: 36, y: 794, font: helv, size: 11, color: rgb(1, 1, 1) });

  let y = 750;
  safeDrawText(page, 'Property ID', { x: 36, y, font: helvBold, size: 11, color: slate });
  safeDrawText(page, property.propertyCode || '-', { x: 200, y, font: helv, size: 12, color: slate });
  y -= 20;

  safeDrawText(page, 'Property Name', { x: 36, y, font: helvBold, size: 11, color: slate });
  safeDrawText(page, property.name, { x: 200, y, font: helv, size: 12, color: slate });
  y -= 20;

  safeDrawText(page, 'Address', { x: 36, y, font: helvBold, size: 11, color: slate });
  y = drawWrapped(page, property.address, {
    x: 200, y, font: helv, size: 11, maxWidth: 360, lineHeight: 14, color: slate,
  }) - 6;

  safeDrawText(page, 'Owner', { x: 36, y, font: helvBold, size: 11, color: slate });
  safeDrawText(page, `${property.ownerName} <${property.ownerEmail}>`, {
    x: 200, y, font: helv, size: 11, color: slate,
  });
  y -= 20;

  safeDrawText(page, 'Rooms', { x: 36, y, font: helvBold, size: 11, color: slate });
  safeDrawText(page, String(property.numberOfRooms ?? '-'), { x: 200, y, font: helv, size: 11, color: slate });
  y -= 20;

  safeDrawText(page, 'Pricing', { x: 36, y, font: helvBold, size: 11, color: slate });
  safeDrawText(page, property.pricing || '-', { x: 200, y, font: helv, size: 11, color: slate });
  y -= 30;

  safeDrawText(page, 'Audit Summary', { x: 36, y, font: helvBold, size: 13, color: teal });
  y -= 18;
  y = drawWrapped(
    page,
    `This property was audited on-site by ${auditor?.name || 'an authorized auditor'} and ` +
    `subsequently reviewed and approved by ${officerName || 'a centralized officer'} at ` +
    `Retreats by Traveon. By signing below, the property owner confirms acceptance of the ` +
    `terms of onboarding, the accuracy of the recorded details, and consents to the listing ` +
    `of the above property on the Retreats by Traveon platform.`,
    { x: 36, y, font: helv, size: 11, maxWidth: 520, lineHeight: 16, color: slate }
  ) - 14;

  y -= 30;
  safeDrawText(page, 'Terms', { x: 36, y, font: helvBold, size: 13, color: teal });
  y -= 18;
  const terms = [
    '1. The owner warrants that all information provided is accurate and complete.',
    '2. Retreats by Traveon may inspect the property again with reasonable notice.',
    '3. Either party may terminate this contract with 30 days written notice.',
    "4. Disputes are subject to the jurisdiction of the courts at the platform's registered office.",
  ];
  for (const t of terms) {
    y = drawWrapped(page, t, {
      x: 36, y, font: helv, size: 11, maxWidth: 520, lineHeight: 15, color: slate,
    }) - 4;
  }

  // Signature block
  y -= 24;
  safeDrawText(page, 'Owner Signature', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawLine({ start: { x: 36, y: y - 40 }, end: { x: 280, y: y - 40 }, thickness: 1, color: slate });
  safeDrawText(page, 'Print, sign and upload the signed copy in the Retreats by Traveon app.', {
    x: 36, y: y - 60, font: helv, size: 9, color: rgb(0.45, 0.47, 0.52),
  });

  safeDrawText(page, 'Date', { x: 360, y, font: helvBold, size: 11, color: slate });
  page.drawLine({ start: { x: 360, y: y - 40 }, end: { x: 560, y: y - 40 }, thickness: 1, color: slate });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
};

module.exports = { generateContractPdf };
