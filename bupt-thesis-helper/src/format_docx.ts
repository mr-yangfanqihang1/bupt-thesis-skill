// @ts-nocheck
export {};
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function appendAncestorNodeModules(candidates, startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    candidates.push(path.join(current, 'node_modules'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function candidateNodeModulePaths() {
  const candidates = [];
  if (process.env.NODE_PATH) {
    candidates.push(...process.env.NODE_PATH.split(path.delimiter).filter(Boolean));
  }
  appendAncestorNodeModules(candidates, process.cwd());
  appendAncestorNodeModules(candidates, __dirname);
  return [...new Set(candidates.filter(Boolean))];
}

function loadPackage(packageName) {
  try {
    return require(packageName);
  } catch (directError) {
    for (const nodeModulesPath of candidateNodeModulePaths()) {
      try {
        const scopedRequire = createRequire(path.join(nodeModulesPath, '__skill_loader__.js'));
        return scopedRequire(packageName);
      } catch (error) {
      }
    }
    throw directError;
  }
}

const JSZip = loadPackage('jszip');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
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

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attr(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`\\b${escaped}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function textFromXml(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = re.exec(String(xml || ''))) !== null) {
    parts.push(decodeXml(match[1]));
  }
  return parts.join('').trim();
}

/** 去掉条目前重复的 [1] / [^1]（Word 粘贴或二次处理常出现 [10][10]） */
function stripLeadingBracketReferenceLabels(text) {
  let s = String(text || '').trimStart();
  let prev;
  do {
    prev = s;
    s = s.replace(/^\[\^?\d+\]\s*/, '');
  } while (s !== prev);
  return s.trimStart();
}

/** 去掉自动编号，避免与手写/生成的 [n] 叠成 [8][8] */
function stripParagraphListNumbering(paragraphXml) {
  if (!/<w:pPr\b/.test(paragraphXml)) return paragraphXml;
  return paragraphXml.replace(/<w:pPr(\s[^>]*)?>([\s\S]*?)<\/w:pPr>/, (match, attrs = '', inner) => {
    const cleaned = inner
      .replace(/<w:numPr\b[\s\S]*?<\/w:numPr>/g, '')
      .replace(/<w:numPr\b[^>]*\/>/g, '');
    return `<w:pPr${attrs || ''}>${cleaned}</w:pPr>`;
  });
}

/** 去掉段落样式，避免「endnote text」等与悬挂/对齐/五号直接格式冲突 */
function stripParagraphStyle(paragraphXml) {
  if (!/<w:pPr\b/.test(paragraphXml)) return paragraphXml;
  return paragraphXml.replace(/<w:pPr(\s[^>]*)?>([\s\S]*?)<\/w:pPr>/, (match, attrs = '', inner) => {
    const cleaned = inner.replace(/<w:pStyle\b[^>]*\/>/g, '');
    return `<w:pPr${attrs || ''}>${cleaned}</w:pPr>`;
  });
}

/** 去掉原段缩进与对齐，避免正文「首行缩进」残留在参考文献段；后面由 styleParagraph 统一写悬挂与两端对齐 */
function stripParagraphIndentsAndJc(paragraphXml) {
  if (!/<w:pPr\b/.test(paragraphXml)) return paragraphXml;
  return paragraphXml.replace(/<w:pPr(\s[^>]*)?>([\s\S]*?)<\/w:pPr>/, (match, attrs = '', inner) => {
    const cleaned = inner
      .replace(/<w:ind\b[^>]*\/>/g, '')
      .replace(/<w:ind\b[\s\S]*?<\/w:ind>/g, '')
      .replace(/<w:jc\b[^>]*\/>/g, '')
      .replace(/<w:jc\b[\s\S]*?<\/w:jc>/g, '')
      .replace(/<w:contextualSpacing\b[^>]*\/>/g, '');
    return `<w:pPr${attrs || ''}>${cleaned}</w:pPr>`;
  });
}

/** GB/T 7714 常见版式：五号、中文宋体、西文 Times New Roman、两端对齐、悬挂 0.6cm、1.5 倍行距 */
const REF_HANG_TWIP = Math.round(0.6 * 567);
const REF_RUN_FONT = { eastAsia: '宋体', ascii: 'Times New Roman', hAnsi: 'Times New Roman' };
const REF_RUN_SIZE_HALF_PT = 21; // 10.5pt 五号
const REF_ENTRY_PARAGRAPH_STYLE = {
  font: REF_RUN_FONT,
  sizePt: 10.5,
  bold: false,
  alignment: 'both',
  textColor: '000000',
};
const REF_HEADING_STYLE = {
  font: { eastAsia: '黑体', ascii: 'Times New Roman', hAnsi: 'Times New Roman' },
  sizePt: 16,
  bold: true,
  alignment: 'center',
  textColor: '000000',
  spacingBeforeTwips: 0,
  spacingAfterTwips: 480,
};

/** 在「参考文献」标题前插入奇数页分节（沿用文档末尾 sect 的页边距与纸张设置） */
function injectOddPageSectionBeforeReferences(documentXml) {
  const re = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  let found = null;
  while ((m = re.exec(documentXml)) !== null) {
    const t = textFromXml(m[0]).replace(/\s+/g, '');
    // 取最后一个完全为「参考文献」的段落，避免匹配目录里的同名条目
    if (/^参考文献$/i.test(t)) {
      found = { block: m[0], index: m.index };
    }
  }
  if (!found) return documentXml;
  const before = documentXml.slice(Math.max(0, found.index - 800), found.index);
  if (/w:val="oddPage"/i.test(before)) return documentXml;

  const sects = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g);
  const baseSect = sects && sects.length ? sects[sects.length - 1] : '';
  if (!baseSect) return documentXml;

  let inner = baseSect.replace(/^<w:sectPr(\s[^>]*)?>/i, '').replace(/<\/w:sectPr>\s*$/i, '');
  inner = inner.replace(/<w:type\b[^>]*\/>/gi, '');
  const oddSect = `<w:sectPr><w:type w:val="oddPage"/>${inner}</w:sectPr>`;
  const breaker = `<w:p><w:pPr>${oddSect}</w:pPr><w:r/></w:p>`;
  return documentXml.slice(0, found.index) + breaker + documentXml.slice(found.index);
}

function cmToTwips(cm, fallback) {
  const n = Number(cm);
  return Number.isFinite(n) ? Math.round(n * 567) : fallback;
}

function ptToHalfPoints(pt, fallback) {
  const n = Number(pt);
  return Number.isFinite(n) ? Math.round(n * 2) : fallback;
}

function ptToTwips(pt, fallback) {
  const n = Number(pt);
  return Number.isFinite(n) ? Math.round(n * 20) : fallback;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * 全局西文字体名，必须写在 thesis-format.json（不在此处写死默认值）。
 * 支持 `defaults.latinFont` 或 `defaults.font.latin`。
 */
function requireGlobalLatinFont(defaults, hasStyleEntries) {
  if (!hasStyleEntries) return null;
  const d = defaults || {};
  const fromTop = d.latinFont != null && String(d.latinFont).trim() !== ''
    ? String(d.latinFont).trim()
    : '';
  const fromNested = d.font && typeof d.font === 'object' && d.font.latin != null && String(d.font.latin).trim() !== ''
    ? String(d.font.latin).trim()
    : '';
  const out = fromTop || fromNested;
  if (!out) {
    throw new Error(
      'thesis-format.json 缺少全局西文字体：请在 defaults 中设置 "latinFont": "Times New Roman" '
      + '或 "font": { "latin": "Times New Roman", ... }（可重新运行 inspect_template_docx 生成带该字段的配置）。',
    );
  }
  return out;
}

/** w:pStyle 的 w:val 须与模板 styles.xml 中 w:styleId 一致，不能用英文别名硬编码 */
function paragraphStyleIdFromConfig(style, fallbackStyleId) {
  const id = style && String(style.styleId || '').trim();
  return id || fallbackStyleId;
}

/** 供 rFonts 合并：去掉仅用于配置的键，避免误入样式对象 */
function defaultsFontForMerge(defaults) {
  const d = defaults || {};
  if (!d.font || typeof d.font !== 'object') return {};
  const { latin: _dropLatin, latinExplicit: _dropExplicit, ...rest } = d.font;
  return { ...rest };
}

/** 各样式 font / textColor 与 defaults 浅合并（样式优先）；西文 ascii/hAnsi 统一为全局拉丁字体，除非 font.latinExplicit */
function mergeDefaultsIntoStyles(config) {
  const d = config.defaults || {};
  const defFont = defaultsFontForMerge(d);
  const latinGlobal = requireGlobalLatinFont(d, Object.keys(config.styles || {}).length > 0);
  const defColorRaw = d.textColor != null && String(d.textColor).trim() !== ''
    ? String(d.textColor).trim().replace(/^#/, '')
    : '000000';
  const defColor = /^[0-9A-Fa-f]{6}$/.test(defColorRaw) ? defColorRaw : '000000';
  const styles = config.styles || {};
  const nextStyles = { ...styles };
  for (const [key, val] of Object.entries(styles)) {
    if (!val || typeof val !== 'object') continue;
    const next = { ...val };
    const styleFont = val.font && typeof val.font === 'object' ? val.font : {};
    const latinExplicit = styleFont.latinExplicit === true;
    const { latinExplicit: _e, latin: _latinStyle, ...styleFontRest } = styleFont;
    const mergedFont = { ...defFont, ...styleFontRest };
    if (!latinExplicit && latinGlobal) {
      mergedFont.ascii = latinGlobal;
      mergedFont.hAnsi = latinGlobal;
    }
    if (Object.keys(mergedFont).length) {
      next.font = mergedFont;
    }
    if (val.textColor == null || String(val.textColor).trim() === '') {
      next.textColor = defColor;
    }
    nextStyles[key] = next;
  }
  return { ...config, styles: nextStyles };
}

const ALL_FIXES = ['page', 'body', 'heading', 'caption', 'keyword', 'reference', 'citation', 'toc'];

function parseFixes(value) {
  if (!value || value === true || String(value).trim().toLowerCase() === 'all') {
    return new Set(ALL_FIXES);
  }
  const selected = String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unknown = selected.filter((item) => !ALL_FIXES.includes(item));
  if (unknown.length) {
    throw new Error(`未知修复项: ${unknown.join(', ')}。可选: ${ALL_FIXES.join(', ')}`);
  }
  return new Set(selected);
}

function wantsFix(fixes, name) {
  return fixes.has(name);
}

/** 正文 citation 依赖文末 reference（书签与超链），二者合并处理 */
function expandFixDependencies(fixes) {
  const out = new Set(fixes);
  if (out.has('citation')) {
    out.add('reference');
  }
  return out;
}

function relationTargetById(relsXml, id) {
  const blocks = String(relsXml || '').match(/<Relationship\b[^>]*\/>/g) || [];
  for (const block of blocks) {
    if (!new RegExp(`\\bId="${id}"`).test(block)) continue;
    const tm = block.match(/\bTarget="([^"]+)"/);
    return tm ? tm[1] : null;
  }
  return null;
}

function footerTargetToPartPath(target) {
  const t = String(target || '').replace(/^\/+/, '');
  if (t.startsWith('word/')) return t;
  return `word/${t}`;
}

/** 按 document 中 footerReference 收集要重写的页脚部（默认不改 first） */
function collectFooterPartPaths(documentXml, relsXml, applyTypes) {
  const allow = new Set(applyTypes && applyTypes.length ? applyTypes : ['default', 'even']);
  const out = new Set();
  const re = /<w:footerReference([^/]+)\/>/g;
  let m;
  while ((m = re.exec(documentXml)) !== null) {
    const attrs = m[1];
    const typ = (attrs.match(/\bw:type="([^"]+)"/) || [])[1] || 'default';
    if (!allow.has(typ)) continue;
    const id = (attrs.match(/\br:id="([^"]+)"/) || [])[1];
    if (!id) continue;
    const target = relationTargetById(relsXml, id);
    if (target) out.add(footerTargetToPartPath(target));
  }
  return [...out];
}

function footerRunRPr(font, sizeHalfPoints) {
  const a = escapeXml(font.ascii || 'Times New Roman');
  const h = escapeXml(font.hAnsi || font.ascii || 'Times New Roman');
  const e = escapeXml(font.eastAsia || '宋体');
  const sz = Number(sizeHalfPoints) || 21;
  return `<w:rFonts w:ascii="${a}" w:hAnsi="${h}" w:eastAsia="${e}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
}

function footerFieldFragment(instruction, rPrInner) {
  const ins = escapeXml(String(instruction || '').trim());
  return `<w:r><w:rPr>${rPrInner}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r>`
    + `<w:r><w:rPr>${rPrInner}</w:rPr><w:instrText xml:space="preserve"> ${ins} </w:instrText></w:r>`
    + `<w:r><w:rPr>${rPrInner}</w:rPr><w:fldChar w:fldCharType="separate"/></w:r>`
    + `<w:r><w:rPr>${rPrInner}</w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
}

function buildFooterParagraphXml(p) {
  const jc = p.alignment === 'center' ? '<w:jc w:val="center"/>' : '';
  const sp = p.spacing || {};
  const lineAttr = sp.line != null ? ` w:line="${Number(sp.line)}"` : '';
  const lrAttr = sp.lineRule ? ` w:lineRule="${escapeXml(sp.lineRule)}"` : '';
  const spacing = `<w:spacing w:before="${sp.before != null ? Number(sp.before) : 0}" w:after="${sp.after != null ? Number(sp.after) : 0}"${lineAttr}${lrAttr}/>`;
  const ind = '<w:ind w:left="0" w:firstLine="0"/>';
  const rpr = footerRunRPr(p.font || {}, p.sizeHalfPoints || 21);
  const runs = (p.runs || []).map((r) => {
    if (r.kind === 'field') return footerFieldFragment(r.instruction, rpr);
    return `<w:r><w:rPr>${rpr}</w:rPr><w:t>${escapeXml(r.text || '')}</w:t></w:r>`;
  }).join('');
  return `<w:p><w:pPr>${spacing}${ind}${jc}</w:pPr>${runs}</w:p>`;
}

function buildPageFooterInnerXml(pageFooter) {
  const paras = pageFooter.paragraphs || [];
  return paras.map((p) => buildFooterParagraphXml(p)).join('');
}

/** 页脚页码展示：cnPageTotal（第 x 页共 x 页）| plainArabic（仅阿拉伯页码域） */
function effectivePageFooter(pageFooter) {
  if (!pageFooter || typeof pageFooter !== 'object') return pageFooter;
  const raw = pageFooter.pageNumberDisplay != null
    ? String(pageFooter.pageNumberDisplay)
    : pageFooter.display != null
      ? String(pageFooter.display)
      : '';
  const mode = raw.trim().toLowerCase();
  if (mode === 'plain' || mode === 'arabic' || mode === 'plainarabic') {
    const base = Array.isArray(pageFooter.paragraphs) && pageFooter.paragraphs[0]
      ? { ...pageFooter.paragraphs[0] }
      : { alignment: 'center', spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' }, font: {}, sizeHalfPoints: 18 };
    return {
      ...pageFooter,
      paragraphs: [{
        ...base,
        runs: [{ kind: 'field', instruction: 'PAGE' }],
      }],
    };
  }
  return pageFooter;
}

async function patchFootersFromConfig(zip, documentXml, pageFooter) {
  const footerCfg = effectivePageFooter(pageFooter);
  if (!footerCfg || !Array.isArray(footerCfg.paragraphs) || !footerCfg.paragraphs.length) return;
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return;
  const relsXml = await relsFile.async('string');
  const types = pageFooter.applyToFooterTypes;
  const targets = collectFooterPartPaths(documentXml, relsXml, types);
  const inner = buildPageFooterInnerXml(footerCfg);
  for (const path of targets) {
    const part = zip.file(path);
    if (!part) continue;
    const orig = await part.async('string');
    const head = orig.match(/^<\?xml[^?]*\?>\s*<w:ftr\b[^>]*>/);
    const open = head ? head[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    zip.file(path, `${open}${inner}</w:ftr>`);
  }
}

/**
 * 按 thesis-format.json 中 toc1/toc2/toc3 改写 styles.xml 里对应 w:styleId 的缩进、行距与 rFonts，
 * 以便更新目录域后版式仍与配置一致（否则目录项常沿用模板内置 TOC 样式）。
 */
function patchTocStyleDefinitionsInStylesXml(stylesXml, config) {
  let xml = String(stylesXml || '');
  const styles = config.styles || {};
  for (const key of ['toc1', 'toc2', 'toc3']) {
    const st = styles[key];
    if (!st || !String(st.styleId || '').trim()) continue;
    const sid = String(st.styleId).trim();
    const re = new RegExp(`<w:style\\b[^>]*\\bw:styleId="${escapeRegex(sid)}"[^>]*>[\\s\\S]*?<\\/w:style>`, 'i');
    xml = xml.replace(re, (block) => patchSingleTocStyleBlock(block, st));
  }
  return xml;
}

function patchSingleTocStyleBlock(block, st) {
  const font = st.font || {};
  const ascii = escapeXml(font.ascii || font.hAnsi || 'Times New Roman');
  const hAnsi = escapeXml(font.hAnsi || font.ascii || 'Times New Roman');
  const eastAsia = escapeXml(font.eastAsia || '宋体');
  let next = block;
  if (/<w:rFonts\b[^>]*\/>/.test(next)) {
    next = next.replace(/<w:rFonts\b[^>]*\/>/, `<w:rFonts w:ascii="${ascii}" w:hAnsi="${hAnsi}" w:eastAsia="${eastAsia}"/>`);
  } else if (/<w:rFonts\b[\s\S]*?<\/w:rFonts>/.test(next)) {
    next = next.replace(/<w:rFonts\b[\s\S]*?<\/w:rFonts>/, `<w:rFonts w:ascii="${ascii}" w:hAnsi="${hAnsi}" w:eastAsia="${eastAsia}"/>`);
  }
  const half = ptToHalfPoints(st.sizePt, null);
  if (half) {
    next = next.replace(/<w:sz\b[^>]*\/>/g, `<w:sz w:val="${half}"/>`);
    next = next.replace(/<w:szCs\b[^>]*\/>/g, `<w:szCs w:val="${half}"/>`);
  }
  if (/<w:pPr\b[\s\S]*?<\/w:pPr>/i.test(next)) {
    next = next.replace(/<w:pPr(\s[^>]*)?>([\s\S]*?)<\/w:pPr>/i, (full, attrs, inner) => {
      let inner2 = inner;
      if (Number.isFinite(st.linePt)) {
        const lineTw = ptToTwips(st.linePt, null);
        if (lineTw) {
          const spacingXml = `<w:spacing w:before="0" w:after="0" w:line="${lineTw}" w:lineRule="exact"/>`;
          if (/<w:spacing\b[^>]*\/>/.test(inner2)) {
            inner2 = inner2.replace(/<w:spacing\b[^>]*\/>/, spacingXml);
          } else if (/<w:spacing\b[\s\S]*?<\/w:spacing>/.test(inner2)) {
            inner2 = inner2.replace(/<w:spacing\b[\s\S]*?<\/w:spacing>/, spacingXml);
          } else {
            inner2 = spacingXml + inner2;
          }
        }
      }
      const twFromCm = (cm) => {
        const n = Number(cm);
        return Number.isFinite(n) ? Math.round(n * 567) : 0;
      };
      const indXml = `<w:ind w:left="${twFromCm(st.leftCm)}" w:firstLine="${twFromCm(st.firstLineCm)}" w:hanging="${twFromCm(st.hangingCm)}"/>`;
      if (/<w:ind\b[^>]*\/>/.test(inner2)) {
        inner2 = inner2.replace(/<w:ind\b[^>]*\/>/, indXml);
      } else if (/<w:ind\b[\s\S]*?<\/w:ind>/.test(inner2)) {
        inner2 = inner2.replace(/<w:ind\b[\s\S]*?<\/w:ind>/, indXml);
      } else {
        inner2 = indXml + inner2;
      }
      return `<w:pPr${attrs || ''}>${inner2}</w:pPr>`;
    });
  }
  return next;
}

function printFixPlan(documentXml, fixes, config, relsXml) {
  const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const texts = paragraphs.map(textFromXml).filter(Boolean);
  const captionCount = texts.filter((text) => /^(图|表)\s+\d+(?:-\d+)+\s+/.test(text) || /^(图|表)\d+(?:-\d+)+\s+/.test(text)).length;
  const keywordCount = texts.filter((text) => /^(关键词|KEY\s+WORDS)\b/i.test(text)).length;
  const citationCount = texts.reduce((sum, text) => sum + ((text.match(citationRegex()) || []).length), 0);
  const referenceStart = texts.findIndex((text) => text.replace(/\s+/g, '') === '参考文献');
  const referenceStop = referenceStart >= 0
    ? texts.findIndex((text, index) => index > referenceStart && isReferenceStop(text))
    : -1;
  const referenceCount = referenceStart >= 0
    ? texts.slice(referenceStart + 1, referenceStop >= 0 ? referenceStop : texts.length).filter(Boolean).length
    : 0;
  const headingCount = texts.filter((text) => {
    const c = text.replace(/\s+/g, '');
    if (/^目录$/i.test(c)) return false;
    const tSec = normalizeTextForSectionHeadingMatch(text);
    return /^(摘要|ABSTRACT)$/i.test(c) || isChapterHeading(text)
      || sectionHeadingDepthFromNormalizedText(tSec) > 0;
  }).length;
  const bodyCount = Math.max(0, texts.length - headingCount - captionCount - keywordCount - referenceCount);
  let footerTargets = 0;
  if (relsXml && config.pageFooter && wantsFix(fixes, 'page')) {
    footerTargets = collectFooterPartPaths(
      documentXml,
      relsXml,
      config.pageFooter.applyToFooterTypes,
    ).length;
  }
  const lines = [
    '可应用修复项:',
    `[page] 页面设置：${config.page ? '可根据 thesis-format.json 修复' : '未提供格式配置'} ${wantsFix(fixes, 'page') ? '(将应用)' : '(跳过)'}`,
    `[pageFooter] 页码域：${config.pageFooter && footerTargets ? `将重写 ${footerTargets} 个页脚部（default/even）` : '无配置或跳过'} ${wantsFix(fixes, 'page') && config.pageFooter ? '(将应用)' : '(跳过)'}`,
    `[body] 正文样式/1.5 倍行距：约 ${bodyCount} 段 ${wantsFix(fixes, 'body') ? '(将应用)' : '(跳过)'}`,
    `[heading] 标题样式：约 ${headingCount} 段 ${wantsFix(fixes, 'heading') ? '(将应用)' : '(跳过)'}`,
    `[caption] 图表题注样式：约 ${captionCount} 段 ${wantsFix(fixes, 'caption') ? '(将应用)' : '(跳过)'}`,
    `[keyword] 关键词标签加粗：约 ${keywordCount} 段 ${wantsFix(fixes, 'keyword') ? '(将应用)' : '(跳过)'}`,
    `[reference] 参考文献编号/悬挂缩进：约 ${referenceCount} 条 ${wantsFix(fixes, 'reference') ? '(将应用)' : '(跳过)'}`,
    `[citation] 正文引用上角标与双向链接：约 ${citationCount} 处 ${wantsFix(fixes, 'citation') ? '(将应用)' : '(跳过)'}`,
    `[toc] 目录域标脏 + settings 更新域 + styles.xml 中 TOC1/2/3：${wantsFix(fixes, 'toc') ? '(将应用)' : '(跳过)'}`,
  ];
  console.log(lines.join('\n'));
}

function ensureChild(parentXml, tagName, insertBeforeClosingTag) {
  const re = new RegExp(`<${tagName}\\b[\\s\\S]*?\\/>|<${tagName}\\b[\\s\\S]*?<\\/${tagName.split(':').pop()}>`);
  if (re.test(parentXml)) return parentXml;
  return parentXml.replace(insertBeforeClosingTag, `<${tagName}/>${insertBeforeClosingTag}`);
}

function replaceOrInsertPPr(paragraphXml, pPrPatch) {
  if (/<w:pPr\b[\s\S]*?<\/w:pPr>/.test(paragraphXml)) {
    return paragraphXml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, (pPr) => {
      let next = pPr;
      for (const [tag, xml] of Object.entries(pPrPatch)) {
        const tagName = tag.replace(/^w:/, '');
        const re = new RegExp(`<w:${tagName}\\b[^>]*/>|<w:${tagName}\\b[\\s\\S]*?<\\/w:${tagName}>`);
        if (re.test(next)) {
          next = next.replace(re, xml);
        } else {
          next = next.replace('</w:pPr>', `${xml}</w:pPr>`);
        }
      }
      return next;
    });
  }
  return paragraphXml.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr>${Object.values(pPrPatch).join('')}</w:pPr>`);
}

function styleParagraph(paragraphXml, style = {}, extra = {}) {
  const font = style.font || {};
  const size = ptToHalfPoints(style.sizePt, null);
  const line = extra.line !== undefined
    ? Number(extra.line)
    : extra.lineRule === 'auto'
      ? 360
      : ptToTwips(style.linePt, null);
  const lineRule = extra.lineRule || (line ? 'exact' : '');
  const firstLine = cmToTwips(style.firstLineCm, null);
  const hanging = cmToTwips(style.hangingCm, null);
  const left = cmToTwips(style.leftCm, null);
  const jc = style.alignment || extra.alignment;
  const resolvedBefore = extra.before !== undefined
    ? extra.before
    : (Number.isFinite(style.spacingBeforeTwips) ? style.spacingBeforeTwips : undefined);
  const resolvedAfter = extra.after !== undefined
    ? extra.after
    : (Number.isFinite(style.spacingAfterTwips) ? style.spacingAfterTwips : undefined);
  const pPrPatch = {};
  if (extra.styleId) {
    pPrPatch['w:pStyle'] = `<w:pStyle w:val="${escapeXml(extra.styleId)}"/>`;
  }
  if (extra.pageBreakBefore) {
    pPrPatch['w:pageBreakBefore'] = '<w:pageBreakBefore w:val="1"/>';
  }
  if (jc) {
    const jcVal = jc === 'both' || jc === 'justify' ? 'both' : jc;
    pPrPatch['w:jc'] = `<w:jc w:val="${escapeXml(jcVal)}"/>`;
  }
  if (line || resolvedBefore !== undefined || resolvedAfter !== undefined) {
    const attrs = [];
    if (resolvedBefore !== undefined) attrs.push(`w:before="${Number(resolvedBefore) || 0}"`);
    if (resolvedAfter !== undefined) attrs.push(`w:after="${Number(resolvedAfter) || 0}"`);
    if (line) attrs.push(`w:line="${line}" w:lineRule="${lineRule}"`);
    pPrPatch['w:spacing'] = `<w:spacing ${attrs.join(' ')}/>`;
  }
  const indAttrs = [];
  if (!extra.indXml) {
    if (left !== null || extra.left !== undefined) indAttrs.push(`w:left="${extra.left !== undefined ? extra.left : left}"`);
    if (firstLine !== null || extra.firstLine !== undefined) indAttrs.push(`w:firstLine="${extra.firstLine !== undefined ? extra.firstLine : firstLine}"`);
    if (hanging !== null || extra.hanging !== undefined) indAttrs.push(`w:hanging="${extra.hanging !== undefined ? extra.hanging : hanging}"`);
  }
  // 勿与 w:firstLine（twips）同时写 firstLineChars="0"：Word 常按「字符单位」覆盖掉首行缩进
  if (indAttrs.length) {
    pPrPatch['w:ind'] = `<w:ind ${indAttrs.join(' ')}/>`;
  }
  if (extra.indXml) {
    pPrPatch['w:ind'] = extra.indXml;
  }
  let next = replaceOrInsertPPr(paragraphXml, pPrPatch);
  if (font.eastAsia || font.ascii || font.hAnsi || size || style.bold !== undefined) {
    next = next.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (runXml) => styleRun(runXml, style));
  }
  return next;
}

function normalizeTextColorHex(style) {
  const raw = String(style.textColor || '000000').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(raw) ? raw : '000000';
}

function styleRun(runXml, style = {}, forceBold = null) {
  const font = style.font || {};
  const size = ptToHalfPoints(style.sizePt, null);
  const rPrParts = [];
  if (font.eastAsia || font.ascii || font.hAnsi) {
    const ascii = escapeXml(font.ascii || font.hAnsi || 'Times New Roman');
    const eastAsia = escapeXml(font.eastAsia || '宋体');
    const hAnsi = escapeXml(font.hAnsi || font.ascii || 'Times New Roman');
    rPrParts.push(`<w:rFonts w:ascii="${ascii}" w:eastAsia="${eastAsia}" w:hAnsi="${hAnsi}"/>`);
  }
  if (size) {
    rPrParts.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  }
  const bold = forceBold === null ? style.bold : forceBold;
  if (bold) {
    rPrParts.push('<w:b/><w:bCs/>');
  }
  if (!rPrParts.length) return runXml;
  const colorHex = escapeXml(normalizeTextColorHex(style));
  rPrParts.push(`<w:color w:val="${colorHex}"/>`);
  if (/<w:rPr\b[\s\S]*?<\/w:rPr>/.test(runXml)) {
    let next = runXml.replace(/<w:rPr\b[\s\S]*?<\/w:rPr>/, (rPr) => {
      let patched = rPr
        .replace(/<w:rFonts\b[^>]*\/>/g, '')
        .replace(/<w:sz\b[^>]*\/>/g, '')
        .replace(/<w:szCs\b[^>]*\/>/g, '')
        .replace(/<w:color\b[^>]*\/>/g, '')
        .replace(/<w:color\b[^>]*>[\s\S]*?<\/w:color>/g, '')
        .replace(/<w:u\b[^>]*\/>/g, '')
        .replace(/<w:u\b[^>]*>[\s\S]*?<\/w:u>/g, '');
      if (bold) patched = patched.replace(/<w:b\b[^>]*\/>/g, '').replace(/<w:bCs\b[^>]*\/>/g, '');
      return patched.replace('</w:rPr>', `${rPrParts.join('')}</w:rPr>`);
    });
    return next;
  }
  return runXml.replace(/<w:r\b([^>]*)>/, `<w:r$1><w:rPr>${rPrParts.join('')}</w:rPr>`);
}

function syntheticTextRun(plain) {
  return `<w:r><w:t xml:space="preserve">${escapeXml(plain)}</w:t></w:r>`;
}

/** 仅加粗「关键词」/「KEY WORDS」标签；若标签与正文在同一 w:r，则拆分以免空 styleRun 剥掉西文字体 */
function boldKeywordLabel(paragraphXml, keywordStyle = {}) {
  const text = textFromXml(paragraphXml);
  const label = /^关键词\b/.test(text) ? '关键词' : /^KEY\s+WORDS\b/i.test(text) ? 'KEY WORDS' : '';
  if (!label) return paragraphXml;
  const labelChars = label.length;
  let offset = 0;
  return paragraphXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (runXml) => {
    const runText = textFromXml(runXml);
    if (!runText) return runXml;
    const start = offset;
    const end = offset + runText.length;
    offset = end;
    if (end <= labelChars) {
      return styleRun(runXml, keywordStyle, true);
    }
    if (start >= labelChars) {
      return styleRun(runXml, keywordStyle, false);
    }
    const cut = labelChars - start;
    const pre = runText.slice(0, cut);
    const post = runText.slice(cut);
    return styleRun(syntheticTextRun(pre), keywordStyle, true) + styleRun(syntheticTextRun(post), keywordStyle, false);
  });
}

function isReferenceStop(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  return /^(致谢|附录|附录[A-ZＡ-Ｚ一二三四五六七八九十]*)$/i.test(compact);
}

function isChapterHeading(text) {
  const trimmed = String(text || '').trim();
  if (/^第(?:[一二三四五六七八九十百千]+|\d+)章[为是]/.test(trimmed)) return false;
  // 第一章 标题 / 第一章标题 / 第1章 标题（不要求「章」后必须有空格）
  return /^第(?:[一二三四五六七八九十百千]+|\d+)章(?:\s+|)\S/.test(trimmed);
}

let bookmarkNumericId = 1000;

function nextBookmarkId() {
  bookmarkNumericId += 1;
  return bookmarkNumericId;
}

function citationRegex() {
  return /\[\^?(\d+(?:\s*[-,，、]\s*\d+)*)\]/g;
}

function expandCitationKeys(rawKey) {
  const keys = [];
  String(rawKey || '').split(/\s*[,，、]\s*/).forEach((part) => {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const step = start <= end ? 1 : -1;
        for (let current = start; current !== end + step; current += step) {
          keys.push(String(current));
        }
      }
      return;
    }
    if (/^\d+$/.test(part)) {
      keys.push(part);
    }
  });
  return [...new Set(keys)];
}

function bookmarkName(prefix, key, index = '') {
  return `${prefix}_${String(key).replace(/\D+/g, '_')}${index ? `_${index}` : ''}`.replace(/_+/g, '_');
}

function textRunXml(text, options = {}) {
  const rPr = [];
  if (options.font) {
    const f = options.font;
    rPr.push(
      `<w:rFonts w:ascii="${escapeXml(f.ascii)}" w:eastAsia="${escapeXml(f.eastAsia)}" w:hAnsi="${escapeXml(f.hAnsi)}"/>`,
    );
  }
  if (options.sizeHalfPoints) {
    const sz = Number(options.sizeHalfPoints);
    rPr.push(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`);
  }
  if (options.superscript) {
    rPr.push('<w:vertAlign w:val="superscript"/>');
  }
  if (options.bold) {
    rPr.push('<w:b/><w:bCs/>');
  }
  const rPrXml = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
  return `<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function bookmarkStartXml(name, id) {
  return `<w:bookmarkStart w:id="${id}" w:name="${escapeXml(name)}"/>`;
}

function bookmarkEndXml(id) {
  return `<w:bookmarkEnd w:id="${id}"/>`;
}

function hyperlinkXml(anchor, childXml) {
  return `<w:hyperlink w:anchor="${escapeXml(anchor)}" w:history="1">${childXml}</w:hyperlink>`;
}

function paragraphWithRuns(paragraphXml, runsXml) {
  const pPr = (paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/) || [''])[0];
  return paragraphXml.replace(/<w:p\b([^>]*)>[\s\S]*<\/w:p>/, `<w:p$1>${pPr}${runsXml}</w:p>`);
}

function patchCitationRuns(paragraphXml, citationAnchors) {
  const text = textFromXml(paragraphXml);
  if (!citationRegex().test(text)) return paragraphXml;
  const regex = citationRegex();
  let lastIndex = 0;
  let match;
  const runs = [];
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(textRunXml(text.slice(lastIndex, match.index)));
    }
    const rawKey = match[1].replace(/\s+/g, '');
    const keys = expandCitationKeys(rawKey);
    keys.forEach((key) => {
      const list = citationAnchors[key] || [];
      const citeIndex = list.length + 1;
      const anchor = bookmarkName('cite', key, citeIndex);
      list.push(anchor);
      citationAnchors[key] = list;
      const id = nextBookmarkId();
      runs.push(bookmarkStartXml(anchor, id), bookmarkEndXml(id));
    });
    const target = bookmarkName('ref', keys[0] || rawKey);
    runs.push(hyperlinkXml(target, textRunXml(`[${rawKey}]`, { superscript: true })));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    runs.push(textRunXml(text.slice(lastIndex)));
  }
  return paragraphWithRuns(paragraphXml, runs.join(''));
}

function referenceParagraph(paragraphXml, key, referenceText, style, citationAnchors, extra) {
  let paraXml = stripParagraphListNumbering(paragraphXml);
  paraXml = stripParagraphStyle(paraXml);
  paraXml = stripParagraphIndentsAndJc(paraXml);
  const refAnchor = bookmarkName('ref', key);
  const bookmarkId = nextBookmarkId();
  const firstCitation = citationAnchors[key] && citationAnchors[key][0];
  const runOpts = { font: REF_RUN_FONT, sizeHalfPoints: REF_RUN_SIZE_HALF_PT };
  const labelRun = textRunXml(`[${key}]`, runOpts);
  const label = firstCitation ? hyperlinkXml(firstCitation, labelRun) : labelRun;
  const runs = [
    bookmarkStartXml(refAnchor, bookmarkId),
    label,
    bookmarkEndXml(bookmarkId),
    textRunXml(` ${referenceText}`, runOpts),
  ].join('');
  const rebuilt = paragraphWithRuns(paraXml, runs);
  return styleParagraph(rebuilt, style || {}, extra);
}

/** 节编号「1.1 / １．１」匹配用：全角数字与句点、零宽与双向控制符 */
function normalizeTextForSectionHeadingMatch(raw) {
  let s = String(raw || '')
    .replace(/[\u200b-\u200d\ufeff\u2060]/g, '')
    .replace(/^[\u200e\u200f\u202a-\u202e]+/, '');
  s = s.replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/\uFF0E/g, '.');
  return s.trimStart();
}

/** 2 = 1.1 节，3 = 1.1.1 节；0 表示不匹配 */
function sectionHeadingDepthFromNormalizedText(norm) {
  const s = String(norm || '');
  if (/^\d+\.\d+\.\d+(?:\s+\S|(?=[\u4e00-\u9fffA-Za-z]))/.test(s)) return 3;
  if (/^\d+\.\d+(?:\s+\S|(?=[\u4e00-\u9fffA-Za-z]))/.test(s)) return 2;
  return 0;
}

/** 同一段内软换行（w:br 且非分页）前的文本，用于「1.1 标题⏎正文」式单段；无则返回 null */
function textFromXmlBeforeFirstNonPageBreak(paragraphXml) {
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

function isTocFieldResultParagraph(paragraphXml) {
  const s = String(paragraphXml || '');
  return /PAGEREF\s+_Toc/i.test(s) || /HYPERLINK\s+\\l\s+_Toc/i.test(s);
}

function patchParagraphs(documentXml, config, fixes) {
  const styles = config.styles || {};
  let inReferences = false;
  let contentStarted = false;
  let inAbstractZh = false;
  let inAbstractEn = false;
  let referenceNumber = 1;
  const citationAnchors = {};
  const bodySpacing = { line: 360, lineRule: 'auto' };
  const noFirstLine = { firstLine: 0 };
  return documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const text = textFromXml(paragraphXml);
    const beforeBr = textFromXmlBeforeFirstNonPageBreak(paragraphXml);
    const textLeadForSection = beforeBr != null && String(beforeBr).trim() !== '' ? beforeBr : text;
    const textForSection = normalizeTextForSectionHeadingMatch(textLeadForSection);
    const compact = text.replace(/\s+/g, '');
    if (!text) return paragraphXml;
    let next = paragraphXml;
    if (/^参考文献$/i.test(compact)) {
      contentStarted = true;
      inAbstractZh = false;
      inAbstractEn = false;
      inReferences = true;
      if (!wantsFix(fixes, 'heading')) {
        return paragraphXml;
      }
      let refTitle = stripParagraphListNumbering(next);
      refTitle = stripParagraphStyle(refTitle);
      return styleParagraph(refTitle, REF_HEADING_STYLE, {
        line: 360,
        lineRule: 'auto',
        before: 0,
        firstLine: 0,
        left: 0,
        hanging: 0,
      });
    }
    if (inReferences && isReferenceStop(text)) {
      inReferences = false;
      // 致谢/附录：勿用 BUPTHeading1，否则会被 TOC \\t BUPTHeading* 收进目录
      const backTitle = styles.abstractTitle || {};
      return wantsFix(fixes, 'heading')
        ? styleParagraph(next, backTitle, {
          styleId: paragraphStyleIdFromConfig(backTitle, 'Heading1'),
          alignment: 'center',
          before: 0,
          line: ptToTwips(backTitle.linePt || 18, 360),
          lineRule: 'exact',
          ...noFirstLine,
        })
        : paragraphXml;
    }
    // 「目录」勿套 Heading1：多为 TOC 域前标题，改样式会破坏目录；留给用户在 Word 里更新域
    if (/^目录$/i.test(compact)) {
      contentStarted = true;
      return paragraphXml;
    }
    // 目录域结果里也有「1.1 标题 + 页码」，不能按正文节标题套 BUPTHeading2；目录样式由 toc 修复/Word 更新域处理。
    if (isTocFieldResultParagraph(paragraphXml)) {
      contentStarted = true;
      return paragraphXml;
    }
    if (/^摘要$/i.test(compact)) {
      contentStarted = true;
      inAbstractZh = true;
      inAbstractEn = false;
      const at = styles.abstractTitle || {};
      return wantsFix(fixes, 'heading')
        ? styleParagraph(next, at, {
          styleId: paragraphStyleIdFromConfig(at, 'Heading1'),
          alignment: 'center',
          line: ptToTwips(at.linePt || 18, 360),
          lineRule: 'exact',
          ...noFirstLine,
        })
        : paragraphXml;
    }
    if (/^ABSTRACT$/i.test(compact)) {
      contentStarted = true;
      inAbstractEn = true;
      inAbstractZh = false;
      const en = styles.abstractEnTitle || styles.abstractTitle || {};
      return wantsFix(fixes, 'heading')
        ? styleParagraph(next, en, {
          styleId: paragraphStyleIdFromConfig(en, 'Heading1'),
          alignment: 'center',
          line: ptToTwips(en.linePt || 18, 360),
          lineRule: 'exact',
          ...noFirstLine,
        })
        : paragraphXml;
    }
    // 致谢、附录：用 abstractTitle（多为内置 heading 1），不进 BUPT 目录域
    if (/^(致谢|附录|附录[A-ZＡ-Ｚ一二三四五六七八九十]*)$/i.test(compact)) {
      contentStarted = true;
      inAbstractZh = false;
      inAbstractEn = false;
      const backTitle = styles.abstractTitle || {};
      return wantsFix(fixes, 'heading')
        ? styleParagraph(next, backTitle, {
          styleId: paragraphStyleIdFromConfig(backTitle, 'Heading1'),
          alignment: 'center',
          before: 0,
          line: ptToTwips(backTitle.linePt || 18, 360),
          lineRule: 'exact',
          ...noFirstLine,
        })
        : paragraphXml;
    }
    if (isChapterHeading(text)) {
      contentStarted = true;
      inReferences = false;
      inAbstractZh = false;
      inAbstractEn = false;
      const h1 = styles.heading1 || {};
      return wantsFix(fixes, 'heading')
        ? styleParagraph(next, h1, {
          styleId: paragraphStyleIdFromConfig(h1, 'Heading1'),
          alignment: 'center',
          line: ptToTwips(h1.linePt || 18, 360),
          lineRule: 'exact',
          before: 0,
          after: Number.isFinite(h1.spacingAfterTwips) ? h1.spacingAfterTwips : 480,
          ...noFirstLine,
        })
        : paragraphXml;
    }
    // 二/三级节标题须在「contentStarted」守卫之前识别；并清除 inReferences，避免前文「参考文献」后状态残留把 1.1 当成文献条目
    const secDepth = sectionHeadingDepthFromNormalizedText(textForSection);
    if (secDepth) {
      contentStarted = true;
      inReferences = false;
      if (secDepth === 3) {
        const h3 = styles.heading3 || {};
        return wantsFix(fixes, 'heading')
          ? styleParagraph(next, h3, {
            styleId: paragraphStyleIdFromConfig(h3, 'Heading3'),
            line: ptToTwips(h3.linePt || 18, 360),
            lineRule: 'exact',
            before: Number.isFinite(h3.spacingBeforeTwips) ? h3.spacingBeforeTwips : 156,
            after: Number.isFinite(h3.spacingAfterTwips) ? h3.spacingAfterTwips : 156,
            ...noFirstLine,
          })
          : paragraphXml;
      }
      const h2 = styles.heading2 || {};
      return wantsFix(fixes, 'heading')
        ? styleParagraph(next, h2, {
          styleId: paragraphStyleIdFromConfig(h2, 'Heading2'),
          line: ptToTwips(h2.linePt || 18, 360),
          lineRule: 'exact',
          before: Number.isFinite(h2.spacingBeforeTwips) ? h2.spacingBeforeTwips : 156,
          after: Number.isFinite(h2.spacingAfterTwips) ? h2.spacingAfterTwips : 156,
          ...noFirstLine,
        })
        : paragraphXml;
    }
    if (!contentStarted) {
      return paragraphXml;
    }
    if (/^(图|表)\s+\d+(?:-\d+)+\s+/.test(text) || /^(图|表)\d+(?:-\d+)+\s+/.test(text)) {
      const cap = styles.caption || {};
      const capBefore = Number.isFinite(cap.spacingBeforeTwips) ? cap.spacingBeforeTwips : 156;
      const capAfter = Number.isFinite(cap.spacingAfterTwips) ? cap.spacingAfterTwips : 156;
      return wantsFix(fixes, 'caption')
        ? styleParagraph(next, cap, {
          styleId: paragraphStyleIdFromConfig(cap, 'Caption'),
          alignment: 'center',
          line: ptToTwips(cap.linePt || 15, 360),
          lineRule: 'exact',
          before: capBefore,
          after: capAfter,
          ...noFirstLine,
        })
        : paragraphXml;
    }
    if (inReferences) {
      const refSecDepth = sectionHeadingDepthFromNormalizedText(textForSection);
      if (refSecDepth) {
        inReferences = false;
        contentStarted = true;
        if (!wantsFix(fixes, 'heading')) {
          return paragraphXml;
        }
        if (refSecDepth === 3) {
          const h3 = styles.heading3 || {};
          return styleParagraph(next, h3, {
            styleId: paragraphStyleIdFromConfig(h3, 'Heading3'),
            line: ptToTwips(h3.linePt || 18, 360),
            lineRule: 'exact',
            before: Number.isFinite(h3.spacingBeforeTwips) ? h3.spacingBeforeTwips : 156,
            after: Number.isFinite(h3.spacingAfterTwips) ? h3.spacingAfterTwips : 156,
            ...noFirstLine,
          });
        }
        const h2 = styles.heading2 || {};
        return styleParagraph(next, h2, {
          styleId: paragraphStyleIdFromConfig(h2, 'Heading2'),
          line: ptToTwips(h2.linePt || 18, 360),
          lineRule: 'exact',
          before: Number.isFinite(h2.spacingBeforeTwips) ? h2.spacingBeforeTwips : 156,
          after: Number.isFinite(h2.spacingAfterTwips) ? h2.spacingAfterTwips : 156,
          ...noFirstLine,
        });
      }
      if (!wantsFix(fixes, 'reference')) {
        return paragraphXml;
      }
      let key = String(referenceNumber);
      let referenceText = text.trim();
      const head = referenceText.match(/^\[\^?(\d+)\]/);
      if (head) {
        key = head[1];
        referenceNumber = Math.max(referenceNumber, Number(key));
      }
      referenceText = stripLeadingBracketReferenceLabels(referenceText);
      referenceNumber += 1;
      const h = REF_HANG_TWIP;
      const refExtra = {
        alignment: 'both',
        indXml: `<w:ind w:left="${h}" w:leftChars="0" w:firstLine="-${h}" w:firstLineChars="0" w:hanging="0" w:hangingChars="0"/>`,
        line: 360,
        lineRule: 'auto',
        before: 0,
        after: 0,
      };
      return referenceParagraph(next, key, referenceText, REF_ENTRY_PARAGRAPH_STYLE, citationAnchors, refExtra);
    }
    if (/^(关键词|KEY\s+WORDS)\b/i.test(text)) {
      if (/^关键词\b/.test(text)) inAbstractZh = false;
      if (/^KEY\s+WORDS\b/i.test(text)) inAbstractEn = false;
      if (!wantsFix(fixes, 'keyword')) {
        return paragraphXml;
      }
      const kw = styles.keyword || styles.body || {};
      next = styleParagraph(next, kw, { ...bodySpacing, ...noFirstLine });
      return boldKeywordLabel(next, kw);
    }
    if (wantsFix(fixes, 'citation')) {
      next = patchCitationRuns(next, citationAnchors);
    }
    if (!wantsFix(fixes, 'body')) {
      return next;
    }
    const bodyPara = stripParagraphIndentsAndJc(next);
    const bodyStyle = (inAbstractZh || inAbstractEn) && styles.abstractBody
      ? styles.abstractBody
      : styles.body;
    return styleParagraph(bodyPara, bodyStyle || {}, bodySpacing);
  });
}

/** 去掉段落 XML 中的 Word 批注锚点，便于对「带检测批注的 docx」再格式化后重新送检 */
function stripCommentMarkupFromXml(xml) {
  let s = String(xml || '');
  s = s.replace(/<w:commentRangeStart\b[^/>]*\/>/gi, '');
  s = s.replace(/<w:commentRangeEnd\b[^/>]*\/>/gi, '');
  s = s.replace(/<w:commentReference\b[^/>]*\/>/gi, '');
  s = s.replace(/<w:commentRangeStart\b[^>]*>[\s\S]*?<\/w:commentRangeStart>/gi, '');
  s = s.replace(/<w:commentRangeEnd\b[^>]*>[\s\S]*?<\/w:commentRangeEnd>/gi, '');
  return s;
}

function listWordHeaderFooterFootnoteXmlPaths(zip) {
  return Object.keys(zip.files).filter((name) => {
    const entry = zip.files[name];
    if (!entry || entry.dir) return false;
    return /^word\/((header|footer)\d+\.xml|footnotes\.xml|endnotes\.xml)$/i.test(name);
  });
}

/** 删除 comments 部件并清理页眉/页脚/脚注/尾注中的批注标记（document.xml 由调用方已处理） */
async function stripCommentPartsFromZip(zip) {
  for (const name of listWordHeaderFooterFootnoteXmlPaths(zip)) {
    const part = zip.file(name);
    if (!part) continue;
    const raw = await part.async('string');
    zip.file(name, stripCommentMarkupFromXml(raw));
  }
  const removeNames = [
    'word/comments.xml',
    'word/commentsExtended.xml',
    'word/commentsExtensible.xml',
    'word/commentsIds.xml',
    'word/people.xml',
  ];
  for (const name of removeNames) {
    if (zip.files[name]) {
      delete zip.files[name];
    }
  }
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ct = await ctFile.async('string');
    ct = ct.replace(/<Override\b[^>]*PartName="\/word\/comments\.xml"[^>]*\/>\s*/gi, '');
    ct = ct.replace(/<Override\b[^>]*PartName="\/word\/commentsExtended\.xml"[^>]*\/>\s*/gi, '');
    ct = ct.replace(/<Override\b[^>]*PartName="\/word\/commentsExtensible\.xml"[^>]*\/>\s*/gi, '');
    ct = ct.replace(/<Override\b[^>]*PartName="\/word\/commentsIds\.xml"[^>]*\/>\s*/gi, '');
    ct = ct.replace(/<Override\b[^>]*PartName="\/word\/people\.xml"[^>]*\/>\s*/gi, '');
    zip.file('[Content_Types].xml', ct);
  }
  const docRelsFile = zip.file('word/_rels/document.xml.rels');
  if (docRelsFile) {
    let rels = await docRelsFile.async('string');
    rels = rels.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/comments"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.microsoft\.com\/office\/2011\/relationships\/commentsExtended"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.microsoft\.com\/office\/2016\/09\/relationships\/commentsExtensible"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.microsoft\.com\/office\/2007\/relationships\/people"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*\bTarget="comments\.xml"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*\bTarget="\w+\/comments\.xml"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*\bTarget="people\.xml"[^>]*\/>\s*/gi, '');
    rels = rels.replace(/<Relationship\b[^>]*\bTarget="\w+\/people\.xml"[^>]*\/>\s*/gi, '');
    zip.file('word/_rels/document.xml.rels', rels);
  }
}

function patchPageLayout(documentXml, config) {
  const page = config.page || {};
  const margin = page.margin || {};
  const width = Number(page.widthTwip) || 11906;
  const height = Number(page.heightTwip) || 16838;
  const pgSz = `<w:pgSz w:w="${width}" w:h="${height}"/>`;
  const pgMar = `<w:pgMar w:top="${cmToTwips(margin.topCm, 1440)}" w:right="${cmToTwips(margin.rightCm, 1440)}" w:bottom="${cmToTwips(margin.bottomCm, 1440)}" w:left="${cmToTwips(margin.leftCm, 1440)}" w:header="${cmToTwips(margin.headerCm, 720)}" w:footer="${cmToTwips(margin.footerCm, 720)}" w:gutter="0"/>`;
  return documentXml.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, (sectPr) => {
    let next = sectPr;
    if (/<w:pgSz\b[^>]*\/>/.test(next)) next = next.replace(/<w:pgSz\b[^>]*\/>/, pgSz);
    else next = next.replace('</w:sectPr>', `${pgSz}</w:sectPr>`);
    if (/<w:pgMar\b[^>]*\/>/.test(next)) next = next.replace(/<w:pgMar\b[^>]*\/>/, pgMar);
    else next = next.replace('</w:sectPr>', `${pgMar}</w:sectPr>`);
    return next;
  });
}

async function formatDocx({
  input, output, formatConfig, fixes, dryRun, keepComments,
}) {
  if (!input || (!output && !dryRun)) {
    throw new Error('Usage: node scripts/format_docx.js --input <source.docx> --output <fixed.docx> [--format-config thesis-format.json] [--fix page,body,...] [--dry-run] [--keep-comments]');
  }
  const config = mergeDefaultsIntoStyles(readJsonIfExists(formatConfig));
  const inputPath = path.resolve(input);
  if (!dryRun && output) {
    const outResolved = path.resolve(output);
    if (outResolved === inputPath) {
      throw new Error(
        '输入与输出指向同一 DOCX，会覆盖源文件。请使用另一路径作为 --output（例如 原名-formatted.docx）。',
      );
    }
  }
  const rawFixes = parseFixes(fixes);
  const hadCitationWithoutReference = rawFixes.has('citation') && !rawFixes.has('reference');
  const selectedFixes = expandFixDependencies(rawFixes);
  const sourceBuffer = fs.readFileSync(inputPath);

  const zip = await JSZip.loadAsync(sourceBuffer);
  const documentFile = zip.file('word/document.xml');
  if (documentFile) {
    let documentXml = await documentFile.async('string');
    if (dryRun) {
      if (hadCitationWithoutReference) {
        console.log('[fix] citation 已自动合并 reference（正文角标与文末条目、回链需一起处理）。');
      }
      const relsF = zip.file('word/_rels/document.xml.rels');
      const relsXmlDry = relsF ? await relsF.async('string') : '';
      printFixPlan(documentXml, selectedFixes, config, relsXmlDry);
      return;
    }
    if (wantsFix(selectedFixes, 'page')) {
      documentXml = patchPageLayout(documentXml, config);
    }
    documentXml = patchParagraphs(documentXml, config, selectedFixes);
    if (wantsFix(selectedFixes, 'reference') || wantsFix(selectedFixes, 'heading')) {
      documentXml = injectOddPageSectionBeforeReferences(documentXml);
    }
    // 目录域：仅在选择 toc 时标 dirty，避免 citation/reference 误触全篇域（目录/图表题注域等）
    if (wantsFix(selectedFixes, 'toc')) {
      documentXml = documentXml.replace(
        /<w:fldChar w:fldCharType="begin"(?![^>]*w:dirty=)/g,
        '<w:fldChar w:fldCharType="begin" w:dirty="true"',
      );
      const stylesXmlFile = zip.file('word/styles.xml');
      if (stylesXmlFile) {
        let stylesXml = await stylesXmlFile.async('string');
        stylesXml = patchTocStyleDefinitionsInStylesXml(stylesXml, config);
        zip.file('word/styles.xml', stylesXml);
      }
    }
    if (wantsFix(selectedFixes, 'citation') || wantsFix(selectedFixes, 'reference')) {
      documentXml = documentXml
        .replace(/<w:r><w:bookmarkStart([^>]*)\/><\/w:r>/g, '<w:bookmarkStart$1/>')
        .replace(/<w:r><w:bookmarkEnd([^>]*)\/><\/w:r>/g, '<w:bookmarkEnd$1/>');
    }
    if (wantsFix(selectedFixes, 'page') && config.pageFooter) {
      await patchFootersFromConfig(zip, documentXml, config.pageFooter);
    }
    if (!keepComments) {
      documentXml = stripCommentMarkupFromXml(documentXml);
    }
    zip.file('word/document.xml', documentXml);
  }

  const settingsFile = zip.file('word/settings.xml');
  if (settingsFile && wantsFix(selectedFixes, 'toc')) {
    let settings = await settingsFile.async('string');
    if (!settings.includes('<w:updateFields')) {
      settings = settings.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>');
    }
    zip.file('word/settings.xml', settings);
  }

  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (!dryRun && !keepComments) {
    await stripCommentPartsFromZip(zip);
    console.log('[format] 已移除批注（正文/页眉/页脚等中的批注锚点及 word/comments.xml），便于重新送检。若需保留批注请加 --keep-comments。');
  }
  // 用已读入的 buffer 写出基稿，避免 copyFileSync 在目标/源被占用时更易 EBUSY
  fs.writeFileSync(outputPath, sourceBuffer);
  try {
    fs.chmodSync(outputPath, 0o666);
  } catch (error) {
  }
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, await zip.generateAsync({ type: 'nodebuffer' }));
  try {
    fs.rmSync(outputPath, { force: true });
  } catch (error) {
  }
  fs.renameSync(tempPath, outputPath);
  console.log(`Formatted DOCX copy: ${outputPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await formatDocx({
    input: args.input || args.content || args._[0],
    output: args.output,
    formatConfig: args['format-config'],
    fixes: args.fix,
    dryRun: Boolean(args['dry-run']),
    keepComments: Boolean(args['keep-comments']),
  });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
