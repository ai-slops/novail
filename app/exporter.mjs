import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { DomainError } from './domain.mjs';

export function manuscriptMarkdown(document) {
  return [
    `# ${document.title}`, document.subtitle ? `_${document.subtitle}_` : '',
    ...document.scenes.flatMap((scene) => [`## Chapter ${scene.chapter}. ${scene.title}`, scene.text]),
  ].filter(Boolean).join('\n\n');
}

export async function manuscriptDocx(document) {
  const strings = [document.title, document.subtitle, ...document.scenes.flatMap((scene) => [scene.title, scene.text])];
  // XML 1.0 cannot represent these code points; never silently alter the approved manuscript.
  if (strings.some((text) => !text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text))) {
    throw new DomainError('DOCX_UNSUPPORTED_CHARACTER', 'The manuscript contains control characters that DOCX cannot represent. Review the text or export as Markdown.', 422);
  }
  const children = [new Paragraph({ text: document.title, heading: HeadingLevel.TITLE })];
  if (document.subtitle) children.push(new Paragraph(document.subtitle));
  for (const scene of document.scenes) {
    children.push(new Paragraph({ text: `Chapter ${scene.chapter}. ${scene.title}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
    for (const paragraph of scene.text.replace(/\r\n/g, '\n').split('\n\n')) {
      children.push(new Paragraph({
        children: paragraph.split('\n').map((text, index) => new TextRun({ text, break: index ? 1 : 0 })),
        spacing: { after: 200, line: 360 },
      }));
    }
  }
  return Packer.toBuffer(new Document({
    creator: 'NOVAIL', lastModifiedBy: 'NOVAIL', title: document.title,
    description: document.subtitle, subject: 'Approved snapshot manuscript', revision: 1,
    styles: { default: { document: { run: { font: 'Batang', size: 22 } } } },
    sections: [{ children }],
  }));
}
