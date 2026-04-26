'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
function appendAncestorNodeModules(candidates, startPath) {
    let current = path.resolve(startPath || process.cwd());
    while (true) {
        candidates.push(path.join(current, 'node_modules'));
        const parent = path.dirname(current);
        if (parent === current)
            break;
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
    }
    catch (directError) {
        for (const nodeModulesPath of candidateNodeModulePaths()) {
            try {
                const scopedRequire = createRequire(path.join(nodeModulesPath, '__skill_loader__.js'));
                return scopedRequire(packageName);
            }
            catch (error) {
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
function attr(xml, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(xml || '').match(new RegExp(`\\b${escaped}="([^"]*)"`, 'i'));
    return match ? decodeXml(match[1]) : '';
}
function firstMatch(xml, regex) {
    const match = String(xml || '').match(regex);
    return match ? match[0] : '';
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
function halfPointsToPt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n / 2 : null;
}
function twipsToCm(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Number((n / 567).toFixed(2)) : null;
}
function twipsToPt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Number((n / 20).toFixed(1)) : null;
}
function safeValue(value, fallback = '') {
    return value === null || value === undefined || value === '' ? fallback : value;
}
function parseStyles(stylesXml) {
    const styles = new Map();
    const styleRe = /<w:style\b[\s\S]*?<\/w:style>/g;
    let match;
    while ((match = styleRe.exec(stylesXml || '')) !== null) {
        const xml = match[0];
        const head = xml.slice(0, xml.indexOf('>') + 1);
        if (/w:type="character"/i.test(head))
            continue;
        if (/w:type="table"/i.test(head))
            continue;
        if (/w:type="numbering"/i.test(head))
            continue;
        const id = attr(xml, 'w:styleId');
        if (!id)
            continue;
        const name = attr(firstMatch(xml, /<w:name\b[^>]*\/>/), 'w:val') || id;
        const rFonts = firstMatch(xml, /<w:rFonts\b[^>]*\/>/);
        const sz = firstMatch(xml, /<w:sz\b[^>]*\/>/);
        const spacing = firstMatch(xml, /<w:spacing\b[^>]*\/>/);
        const ind = firstMatch(xml, /<w:ind\b[^>]*\/>/);
        const jc = firstMatch(xml, /<w:jc\b[^>]*\/>/);
        styles.set(id, {
            id,
            name,
            basedOn: attr(firstMatch(xml, /<w:basedOn\b[^>]*\/>/), 'w:val') || '',
            font: {
                eastAsia: attr(rFonts, 'w:eastAsia') || '',
                ascii: attr(rFonts, 'w:ascii') || attr(rFonts, 'w:hAnsi') || '',
                hAnsi: attr(rFonts, 'w:hAnsi') || '',
            },
            sizePt: halfPointsToPt(attr(sz, 'w:val')),
            bold: /<w:b\b/.test(xml),
            alignment: attr(jc, 'w:val') || '',
            linePt: twipsToPt(attr(spacing, 'w:line')),
            firstLineCm: twipsToCm(attr(ind, 'w:firstLine')),
            hangingCm: twipsToCm(attr(ind, 'w:hanging')),
            leftCm: twipsToCm(attr(ind, 'w:left')),
        });
    }
    return styles;
}
function parseDocumentDefaults(stylesXml) {
    const defaultsXml = firstMatch(stylesXml, /<w:docDefaults\b[\s\S]*?<\/w:docDefaults>/);
    const rFonts = firstMatch(defaultsXml, /<w:rFonts\b[^>]*\/>/);
    const sz = firstMatch(defaultsXml, /<w:sz\b[^>]*\/>/);
    const spacing = firstMatch(defaultsXml, /<w:spacing\b[^>]*\/>/);
    return {
        font: {
            eastAsia: attr(rFonts, 'w:eastAsia') || '宋体',
            ascii: attr(rFonts, 'w:ascii') || attr(rFonts, 'w:hAnsi') || 'Times New Roman',
            hAnsi: attr(rFonts, 'w:hAnsi') || 'Times New Roman',
        },
        sizePt: halfPointsToPt(attr(sz, 'w:val')) || 12,
        linePt: twipsToPt(attr(spacing, 'w:line')) || null,
    };
}
function styleByName(styles, candidates) {
    const normalized = candidates.map((item) => item.toLowerCase());
    for (const style of styles.values()) {
        const haystack = `${style.id} ${style.name}`.toLowerCase();
        if (normalized.some((item) => haystack.includes(item))) {
            return style;
        }
    }
    return null;
}
function parseSectionPage(documentXml) {
    const sectPr = firstMatch(documentXml, /<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
    const pgSz = firstMatch(sectPr, /<w:pgSz\b[^>]*\/>/);
    const pgMar = firstMatch(sectPr, /<w:pgMar\b[^>]*\/>/);
    const width = Number(attr(pgSz, 'w:w'));
    const height = Number(attr(pgSz, 'w:h'));
    return {
        size: width === 11906 && height === 16838 ? 'A4' : `${width || '?'}x${height || '?'}`,
        widthTwip: Number.isFinite(width) ? width : null,
        heightTwip: Number.isFinite(height) ? height : null,
        margin: {
            topCm: twipsToCm(attr(pgMar, 'w:top')),
            bottomCm: twipsToCm(attr(pgMar, 'w:bottom')),
            leftCm: twipsToCm(attr(pgMar, 'w:left')),
            rightCm: twipsToCm(attr(pgMar, 'w:right')),
            headerCm: twipsToCm(attr(pgMar, 'w:header')),
            footerCm: twipsToCm(attr(pgMar, 'w:footer')),
        },
    };
}
function parseHeadersFooters(zip) {
    const result = { headers: [], footers: [] };
    for (const name of Object.keys(zip.files)) {
        if (/^word\/header\d+\.xml$/.test(name)) {
            result.headers.push({ file: name, text: '' });
        }
        if (/^word\/footer\d+\.xml$/.test(name)) {
            result.footers.push({ file: name, text: '' });
        }
    }
    return result;
}
async function fillHeadersFooters(zip, containers) {
    for (const item of [...containers.headers, ...containers.footers]) {
        const file = zip.file(item.file);
        if (file) {
            item.text = textFromXml(await file.async('string'));
        }
    }
}
function normalizeStyle(style, fallback) {
    const source = style || {};
    return {
        styleId: source.id || '',
        name: source.name || '',
        font: {
            eastAsia: source.font && source.font.eastAsia ? source.font.eastAsia : fallback.font.eastAsia,
            ascii: source.font && source.font.ascii ? source.font.ascii : fallback.font.ascii,
            hAnsi: source.font && source.font.hAnsi ? source.font.hAnsi : fallback.font.hAnsi,
        },
        sizePt: source.sizePt || fallback.sizePt,
        bold: Boolean(source.bold),
        alignment: source.alignment || '',
        linePt: source.linePt || fallback.linePt || null,
        firstLineCm: source.firstLineCm === null || source.firstLineCm === undefined ? null : source.firstLineCm,
        hangingCm: source.hangingCm === null || source.hangingCm === undefined ? null : source.hangingCm,
        leftCm: source.leftCm === null || source.leftCm === undefined ? null : source.leftCm,
    };
}
function buildFormatConfig({ templatePath, documentXml, stylesXml, headersFooters }) {
    const defaults = parseDocumentDefaults(stylesXml);
    const styles = parseStyles(stylesXml);
    const normal = styleByName(styles, ['normal', '正文']) || styles.get('Normal');
    // 北邮等模板：目录域常用 TOC \\t "BUPTHeading1,1,..."，章标题须套 BUPTHeading* 才会进目录；勿与内置 heading 1(id=2) 混淆
    const headingGeneric1 = styleByName(styles, ['heading 1', '标题 1', '标题1']) || styles.get('Heading1');
    const headingGeneric2 = styleByName(styles, ['heading 2', '标题 2', '标题2']) || styles.get('Heading2');
    const headingGeneric3 = styleByName(styles, ['heading 3', '标题 3', '标题3']) || styles.get('Heading3');
    const heading1 = styleByName(styles, ['buptheading1', 'BUPTHeading1']) || headingGeneric1;
    const heading2 = styleByName(styles, ['buptheading2', 'BUPTHeading2']) || headingGeneric2;
    const heading3 = styleByName(styles, ['buptheading3', 'BUPTHeading3']) || headingGeneric3;
    const toc1 = styleByName(styles, ['toc 1', '目录 1']);
    const toc2 = styleByName(styles, ['toc 2', '目录 2']);
    const toc3 = styleByName(styles, ['toc 3', '目录 3']);
    // 勿用泛词 "reference"，否则会误匹配字符样式「endnote reference」等
    const reference = styleByName(styles, ['参考文献', 'bibliography', '书目', 'reference list']);
    const caption = styleByName(styles, ['caption', '题注']);
    const defaultsWithLatin = { ...defaults, latinFont: 'Times New Roman' };
    const pageFooter = buildPageFooterFromTemplate();
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sourceTemplate: path.resolve(templatePath),
        page: parseSectionPage(documentXml),
        defaults: defaultsWithLatin,
        header: {
            text: headersFooters.headers.map((item) => item.text).filter(Boolean).join(' / '),
            files: headersFooters.headers,
        },
        footer: {
            text: headersFooters.footers.map((item) => item.text).filter(Boolean).join(' / '),
            files: headersFooters.footers,
        },
        pageFooter,
        styles: {
            body: normalizeStyle(normal, defaults),
            abstractTitle: normalizeStyle(headingGeneric1 || heading1 || normal, defaults),
            abstractBody: normalizeStyle(normal, defaults),
            keyword: normalizeStyle(normal, defaults),
            heading1: normalizeStyle(heading1, defaults),
            heading2: normalizeStyle(heading2, defaults),
            heading3: normalizeStyle(heading3, defaults),
            toc1: normalizeStyle(toc1 || heading1, defaults),
            toc2: normalizeStyle(toc2 || heading2, defaults),
            toc3: normalizeStyle(toc3 || heading3, defaults),
            caption: normalizeStyle(caption, defaults),
            reference: normalizeStyle(reference || normal, defaults),
        },
        export: {
            mode: 'template-driven',
            editPolicy: 'modify-md-and-format-config-only',
            templateDocxRequired: true,
        },
    };
}
function styleSummary(name, style) {
    const parts = [];
    if (style.font.eastAsia)
        parts.push(style.font.eastAsia);
    if (style.font.ascii && style.font.ascii !== style.font.eastAsia)
        parts.push(style.font.ascii);
    if (style.sizePt)
        parts.push(`${style.sizePt}pt`);
    if (style.bold)
        parts.push('加粗');
    if (style.linePt)
        parts.push(`行距 ${style.linePt}pt`);
    if (style.firstLineCm)
        parts.push(`首行 ${style.firstLineCm}cm`);
    if (style.alignment)
        parts.push(`对齐 ${style.alignment}`);
    return `- **${name}**：${parts.length ? parts.join('，') : '未从模板识别，使用默认值'}`;
}
/** 撰写指导/论文常用：页脚居中「第 X 页 共 Y 页」（PAGE + NUMPAGES）；可在 thesis-format.json 中改 runs 文本或改为仅 PAGE */
function defaultPageFooterPreset() {
    return {
        version: 1,
        applyToFooterTypes: ['default', 'even'],
        paragraphs: [
            {
                alignment: 'center',
                spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
                font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体' },
                sizeHalfPoints: 21,
                runs: [
                    { kind: 'text', text: '第 ' },
                    { kind: 'field', instruction: 'PAGE' },
                    { kind: 'text', text: ' 页 共 ' },
                    { kind: 'field', instruction: 'NUMPAGES' },
                    { kind: 'text', text: ' 页' },
                ],
            },
        ],
    };
}
/** 《撰写指导》类模板页脚常为示例域/文本框，不宜直接拷贝；统一写入规范页码域，可在 JSON 里改 runs */
function buildPageFooterFromTemplate() {
    return defaultPageFooterPreset();
}
function buildSummary(config) {
    const lines = [];
    lines.push('# 样式确认摘要');
    lines.push('');
    lines.push('> 请确认或编辑本摘要对应的 `thesis-format.json`。后续修改格式只改配置文件，修改正文只改 Markdown。');
    lines.push('');
    lines.push('## 页面设置');
    lines.push('');
    lines.push(`- 纸张：${config.page.size}`);
    lines.push(`- 页边距：上 ${safeValue(config.page.margin.topCm, '?')}cm，下 ${safeValue(config.page.margin.bottomCm, '?')}cm，左 ${safeValue(config.page.margin.leftCm, '?')}cm，右 ${safeValue(config.page.margin.rightCm, '?')}cm`);
    lines.push(`- 页眉距/页脚距：${safeValue(config.page.margin.headerCm, '?')}cm / ${safeValue(config.page.margin.footerCm, '?')}cm`);
    lines.push('');
    lines.push('## 页眉页脚');
    lines.push('');
    lines.push(`- 页眉文本：${config.header.text || '未识别'}`);
    lines.push(`- 页脚文本：${config.footer.text || '未识别'}`);
    if (config.pageFooter && config.pageFooter.paragraphs) {
        lines.push(`- 页码域（pageFooter）：已写入配置，format_docx 在 --fix page 时按 runs 重写 default/even 页脚`);
    }
    lines.push('');
    lines.push('## 样式卡片');
    lines.push('');
    lines.push(styleSummary('摘要标题', config.styles.abstractTitle));
    lines.push(styleSummary('摘要正文', config.styles.abstractBody));
    lines.push(styleSummary('关键词', config.styles.keyword));
    lines.push(styleSummary('一级标题', config.styles.heading1));
    lines.push(styleSummary('二级标题', config.styles.heading2));
    lines.push(styleSummary('三级标题', config.styles.heading3));
    lines.push(styleSummary('正文', config.styles.body));
    lines.push(styleSummary('图表题注', config.styles.caption));
    lines.push(styleSummary('参考文献', config.styles.reference));
    lines.push(styleSummary('目录 TOC 1', config.styles.toc1));
    lines.push(styleSummary('目录 TOC 2', config.styles.toc2));
    lines.push(styleSummary('目录 TOC 3', config.styles.toc3));
    lines.push('');
    lines.push('## 确认项');
    lines.push('');
    lines.push('- [ ] 页面、页眉页脚、页码设置符合模板');
    lines.push('- [ ] 摘要、关键词、目录、正文、标题和参考文献样式符合要求');
    lines.push('- [ ] 若需要润色正文，已明确选择 `--mode polish`；否则使用 `--mode format-only`');
    return `${lines.join('\n')}\n`;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const templateInput = args.template || args['template-docx'] || args._[0];
    if (!templateInput) {
        console.error('Usage: node scripts/inspect_template_docx.js --template <template.docx> [--format-out thesis-format.json] [--summary-out format-summary.md]');
        process.exit(1);
    }
    const templatePath = path.resolve(templateInput);
    if (!fs.existsSync(templatePath)) {
        console.error(`模板 DOCX 不存在: ${templatePath}`);
        process.exit(2);
    }
    const baseName = path.basename(templatePath);
    if (baseName.startsWith('~$')) {
        console.error('路径指向 Word 锁文件（~$ 开头），不是正式模板。请关闭 Word 后使用「北京邮电大学…」主文件路径。');
        process.exit(2);
    }
    const formatOut = path.resolve(args['format-out'] || path.join(path.dirname(templatePath), 'thesis-format.json'));
    const summaryOut = path.resolve(args['summary-out'] || path.join(path.dirname(templatePath), 'format-summary.md'));
    const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
    const documentFile = zip.file('word/document.xml');
    const stylesFile = zip.file('word/styles.xml');
    if (!documentFile || !stylesFile) {
        console.error('模板 DOCX 缺少 word/document.xml 或 word/styles.xml，无法解析。');
        process.exit(2);
    }
    const documentXml = await documentFile.async('string');
    const stylesXml = await stylesFile.async('string');
    const headersFooters = parseHeadersFooters(zip);
    await fillHeadersFooters(zip, headersFooters);
    const config = buildFormatConfig({ templatePath, documentXml, stylesXml, headersFooters });
    fs.writeFileSync(formatOut, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    fs.writeFileSync(summaryOut, buildSummary(config), 'utf-8');
    console.log(`format=${formatOut}`);
    console.log(`summary=${summaryOut}`);
}
main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});
