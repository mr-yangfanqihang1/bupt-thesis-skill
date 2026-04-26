'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textFromXml(xml) {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    out.push(decodeXml(m[1]));
  }
  return out.join('').trim();
}

function attr(xml, name) {
  const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`\\b${escaped}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function normalizeTextForSectionHeadingMatch(raw) {
  let s = String(raw || '')
    .replace(/[\u200b-\u200d\ufeff\u2060]/g, '')
    .replace(/^[\u200e\u200f\u202a-\u202e]+/, '');
  s = s.replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/\uFF0E/g, '.');
  return s.trimStart();
}

function sectionHeadingDepthFromNormalizedText(norm) {
  const s = String(norm || '');
  if (/^\d+\.\d+\.\d+(?:\s+\S|(?=[\u4e00-\u9fffA-Za-z]))/.test(s)) return 3;
  if (/^\d+\.\d+(?:\s+\S|(?=[\u4e00-\u9fffA-Za-z]))/.test(s)) return 2;
  return 0;
}

function textBeforeFirstNonPageBreak(paragraphXml) {
  const s = String(paragraphXml || '');
  const re = /<w:br\b[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tag = m[0];
    if (/w:type\s*=\s*["']page["']/i.test(tag)) continue;
    return textFromXml(s.slice(0, m.index));
  }
  return null;
}

function compactXml(xml) {
  return String(xml || '').replace(/\s+/g, ' ').slice(0, 1800);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || args._[0];
  const needle = args.needle || '研究背景';
  if (!input) {
    throw new Error('Usage: node scripts/debug_docx_paragraphs.js --input <docx> [--needle 研究背景]');
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(input)));
  const xml = await zip.file('word/document.xml').async('string');
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  let hits = 0;
  paragraphs.forEach((p, index) => {
    const text = textFromXml(p);
    if (!text.includes(needle)) return;
    hits += 1;
    const pStyle = (p.match(/<w:pStyle\b[^>]*\/>/) || [''])[0];
    const ind = (p.match(/<w:ind\b[^>]*\/>/) || [''])[0];
    const spacing = (p.match(/<w:spacing\b[^>]*\/>/) || [''])[0];
    const brCount = (p.match(/<w:br\b/gi) || []).length;
    const beforeBr = textBeforeFirstNonPageBreak(p);
    const lead = beforeBr != null && String(beforeBr).trim() !== '' ? beforeBr : text;
    const norm = normalizeTextForSectionHeadingMatch(lead);
    const depth = sectionHeadingDepthFromNormalizedText(norm);
    console.log(`\n# paragraph ${index + 1}`);
    console.log(`text=${JSON.stringify(text.slice(0, 500))}`);
    console.log(`beforeBr=${JSON.stringify(beforeBr)}`);
    console.log(`normalizedLead=${JSON.stringify(norm.slice(0, 160))}`);
    console.log(`sectionDepth=${depth}`);
    console.log(`pStyle=${pStyle || '(none)'} pStyleVal=${attr(pStyle, 'w:val') || '(none)'}`);
    console.log(`spacing=${spacing || '(none)'}`);
    console.log(`ind=${ind || '(none)'}`);
    console.log(`brCount=${brCount}`);
    console.log(`hasComment=${/commentRange|commentReference/.test(p)}`);
    console.log(`xml=${compactXml(p)}`);
  });
  console.log(`\nhits=${hits}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
