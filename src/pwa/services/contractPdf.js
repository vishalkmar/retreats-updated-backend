const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Minimal but readable contract PDF. Produced in-memory and returned as a
// Buffer so we can both email it as an attachment and (optionally) cache
// the URL on the Contract row. Keep this file dependency-free w.r.t. our
// models so it can be reused outside the request lifecycle.

const drawWrapped = (page, text, opts) => {
  const { x, y, font, size, maxWidth, lineHeight, color } = opts;
  const words = String(text || '').split(/\s+/);
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

const generateContractPdf = async ({ property, auditor, officerName }) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.06, 0.46, 0.43);
  const slate = rgb(0.23, 0.24, 0.28);

  // Header band
  page.drawRectangle({ x: 0, y: 790, width: 595, height: 52, color: teal });
  page.drawText('Retreats by Traveon', { x: 36, y: 808, font: helvBold, size: 18, color: rgb(1, 1, 1) });
  page.drawText('Property Onboarding Contract', { x: 36, y: 794, font: helv, size: 11, color: rgb(1, 1, 1) });

  let y = 750;
  page.drawText('Property ID', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawText(property.propertyCode || '—', { x: 200, y, font: helv, size: 12, color: slate });
  y -= 20;

  page.drawText('Property Name', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawText(property.name, { x: 200, y, font: helv, size: 12, color: slate });
  y -= 20;

  page.drawText('Address', { x: 36, y, font: helvBold, size: 11, color: slate });
  y = drawWrapped(page, property.address, {
    x: 200, y, font: helv, size: 11, maxWidth: 360, lineHeight: 14, color: slate,
  }) - 6;

  page.drawText('Owner', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawText(`${property.ownerName} <${property.ownerEmail}>`, {
    x: 200, y, font: helv, size: 11, color: slate,
  });
  y -= 20;

  page.drawText('Rooms', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawText(String(property.numberOfRooms ?? '—'), { x: 200, y, font: helv, size: 11, color: slate });
  y -= 20;

  page.drawText('Pricing', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawText(property.pricing || '—', { x: 200, y, font: helv, size: 11, color: slate });
  y -= 30;

  page.drawText('Audit Summary', { x: 36, y, font: helvBold, size: 13, color: teal });
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
  page.drawText('Terms', { x: 36, y, font: helvBold, size: 13, color: teal });
  y -= 18;
  const terms = [
    '1. The owner warrants that all information provided is accurate and complete.',
    '2. Retreats by Traveon may inspect the property again with reasonable notice.',
    '3. Either party may terminate this contract with 30 days written notice.',
    '4. Disputes are subject to the jurisdiction of the courts at the platform’s registered office.',
  ];
  for (const t of terms) {
    y = drawWrapped(page, t, {
      x: 36, y, font: helv, size: 11, maxWidth: 520, lineHeight: 15, color: slate,
    }) - 4;
  }

  // Signature block
  y -= 24;
  page.drawText('Owner Signature', { x: 36, y, font: helvBold, size: 11, color: slate });
  page.drawLine({ start: { x: 36, y: y - 40 }, end: { x: 280, y: y - 40 }, thickness: 1, color: slate });
  page.drawText('Print, sign and upload the signed copy in the Retreats by Traveon app.', {
    x: 36, y: y - 60, font: helv, size: 9, color: rgb(0.45, 0.47, 0.52),
  });

  page.drawText('Date', { x: 360, y, font: helvBold, size: 11, color: slate });
  page.drawLine({ start: { x: 360, y: y - 40 }, end: { x: 560, y: y - 40 }, thickness: 1, color: slate });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
};

module.exports = { generateContractPdf };
