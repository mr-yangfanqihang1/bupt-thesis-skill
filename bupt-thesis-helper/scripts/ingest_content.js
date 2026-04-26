'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
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
function extractMathChild(xml, tag) {
    const match = String(xml || '').match(new RegExp(`<m:${tag}\\b[^>]*>([\\s\\S]*?)<\\/m:${tag}>`, 'i'));
    return match ? match[1] : '';
}
function normalizeMathText(text) {
    return decodeXml(text)
        .replace(/−/g, '-')
        .replace(/∗/g, '*')
        .replace(/×/g, '\\times ')
        .replace(/≥/g, '\\geq ')
        .replace(/≤/g, '\\leq ')
        .replace(/≠/g, '\\neq ')
        .replace(/∈/g, '\\in ')
        .replace(/∉/g, '\\notin ')
        .replace(/Θ/g, '\\Theta ')
        .replace(/…/g, '\\ldots ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeLatexExpression(text) {
    let normalized = String(text || '')
        .replace(/w_\{(\d)([A-Za-z\\][^}]*)\}/g, (_match, index, suffix) => `w_{${index}}${suffix}`)
        .replace(/\}\s+([A-Za-z])/g, '}$1')
        .replace(/\\Theta\s+\(/g, '\\Theta(')
        .replace(/\\ldots\s+,/g, '\\ldots,')
        .trim();
    if (/\\in\s*\{/.test(normalized)) {
        normalized = normalized.replace(/\\in\s*\{/, '\\in \\{');
        const lastBrace = normalized.lastIndexOf('}');
        if (lastBrace >= 0) {
            normalized = `${normalized.slice(0, lastBrace)}\\}${normalized.slice(lastBrace + 1)}`;
        }
    }
    return normalized;
}
function oMathToLatex(mathXml) {
    let xml = String(mathXml || '');
    let previous = '';
    while (xml !== previous) {
        previous = xml;
        xml = xml
            .replace(/<m:f\b[\s\S]*?<\/m:f>/g, (fragment) => {
            const numerator = extractMathChild(fragment, 'num');
            const denominator = extractMathChild(fragment, 'den');
            return `\\frac{${oMathToLatex(numerator)}}{${oMathToLatex(denominator)}}`;
        })
            .replace(/<m:sSub\b[\s\S]*?<\/m:sSub>/g, (fragment) => {
            const base = extractMathChild(fragment, 'e');
            const sub = extractMathChild(fragment, 'sub');
            return `${oMathToLatex(base)}_{${oMathToLatex(sub)}}`;
        })
            .replace(/<m:sSup\b[\s\S]*?<\/m:sSup>/g, (fragment) => {
            const base = extractMathChild(fragment, 'e');
            const sup = extractMathChild(fragment, 'sup');
            return `${oMathToLatex(base)}^{${oMathToLatex(sup)}}`;
        })
            .replace(/<m:sSubSup\b[\s\S]*?<\/m:sSubSup>/g, (fragment) => {
            const base = extractMathChild(fragment, 'e');
            const sub = extractMathChild(fragment, 'sub');
            const sup = extractMathChild(fragment, 'sup');
            return `${oMathToLatex(base)}_{${oMathToLatex(sub)}}^{${oMathToLatex(sup)}}`;
        });
    }
    return normalizeLatexExpression(normalizeMathText(xml.replace(/<[^>]+>/g, '')));
}
function paragraphText(paragraphXml, options = {}) {
    const parts = [];
    const wrapMath = options.wrapMath !== false;
    const re = /<m:oMath\b[\s\S]*?<\/m:oMath>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let match;
    while ((match = re.exec(String(paragraphXml || ''))) !== null) {
        if (match[0].startsWith('<m:oMath')) {
            const latex = oMathToLatex(match[0]);
            if (latex) {
                parts.push(wrapMath ? `$${latex}$` : latex);
            }
            continue;
        }
        parts.push(decodeXml(match[1]));
    }
    return parts.join('').trim();
}
function paragraphStyle(paragraphXml) {
    const pStyle = String(paragraphXml || '').match(/<w:pStyle\b[^>]*\/>/);
    return pStyle ? attr(pStyle[0], 'w:val') : '';
}
function extractImageRIds(paragraphXml) {
    const ids = [];
    const re = /<a:blip[^>]+r:embed="([^"]+)"/g;
    let match;
    while ((match = re.exec(String(paragraphXml || ''))) !== null) {
        ids.push(match[1]);
    }
    return ids;
}
function parseRelationships(relsXml) {
    const relationships = new Map();
    const re = /<Relationship\b([^>]*)\/>/g;
    let match;
    while ((match = re.exec(relsXml || '')) !== null) {
        const attrs = match[1];
        const id = (attrs.match(/\bId="([^"]+)"/) || [])[1];
        const type = (attrs.match(/\bType="([^"]+)"/) || [])[1];
        const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
        if (id && target && /\/image$/i.test(type || '')) {
            relationships.set(id, target);
        }
    }
    return relationships;
}
function guessHeadingPrefix(text, style) {
    const trimmed = String(text || '').trim();
    const compact = trimmed.replace(/\s+/g, '');
    if (!trimmed)
        return '';
    if (/^(摘要|ABSTRACT|目录|参考文献|致谢|附录)$/i.test(compact))
        return '## ';
    if (/^第[一二三四五六七八九十]+章\s+/.test(trimmed))
        return '## ';
    if (/^\d+\.\d+\.\d+\s+/.test(trimmed))
        return '#### ';
    if (/^\d+\.\d+\s+/.test(trimmed))
        return '### ';
    if (/heading\s*1|title1|标题1|标题 1/i.test(style))
        return '## ';
    if (/heading\s*2|title2|标题2|标题 2/i.test(style))
        return '### ';
    if (/heading\s*3|title3|标题3|标题 3/i.test(style))
        return '#### ';
    return '';
}
function markdownEscape(text) {
    return String(text || '').replace(/\r?\n/g, ' ').trim();
}
function normalizeKeywordMarkdown(text) {
    const trimmed = markdownEscape(text);
    const zhMatch = trimmed.match(/^关键词\s+(.+)$/);
    if (zhMatch) {
        return `**关键词**  ${zhMatch[1].trim()}`;
    }
    const enMatch = trimmed.match(/^KEY\s+WORDS\s+(.+)$/i);
    if (enMatch) {
        return `**KEY WORDS**  ${enMatch[1].trim()}`;
    }
    return trimmed;
}
function markdownTableCell(text) {
    return markdownEscape(text)
        .replace(/\|/g, '\\|')
        .replace(/\s+/g, ' ')
        .trim();
}
function tableRows(tableXml) {
    const rows = [];
    const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(String(tableXml || ''))) !== null) {
        const rowXml = rowMatch[0];
        const cells = [];
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cellMatch;
        while ((cellMatch = cellRe.exec(rowXml)) !== null) {
            const cellText = paragraphText(cellMatch[0]);
            cells.push(markdownTableCell(cellText));
        }
        if (cells.length) {
            rows.push(cells);
        }
    }
    return rows;
}
function stripInlineMathDelimiters(text) {
    return String(text || '').trim().replace(/^\$(.+)\$$/, '$1').trim();
}
function equationTableToMarkdown(rows) {
    if (!rows.length || rows.length > 3)
        return null;
    const formulaBlocks = [];
    rows.forEach((row) => {
        const cells = row.map((cell) => String(cell || '').trim()).filter(Boolean);
        const label = cells.find((cell) => /^式[（(]\d+-\d+[）)]$/.test(cell));
        if (!label)
            return;
        const formula = cells
            .filter((cell) => cell !== label)
            .map(stripInlineMathDelimiters)
            .sort((a, b) => b.length - a.length)[0];
        if (formula) {
            formulaBlocks.push(['$$', `${formula} % ${label}`, '$$', '']);
        }
    });
    return formulaBlocks.length ? formulaBlocks.flat() : null;
}
function tableToMarkdown(tableXml) {
    const rows = tableRows(tableXml);
    if (!rows.length) {
        return [];
    }
    const equationLines = equationTableToMarkdown(rows);
    if (equationLines) {
        return equationLines;
    }
    const maxColumns = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => {
        const next = [...row];
        while (next.length < maxColumns)
            next.push('');
        return next;
    });
    const header = normalizedRows[0];
    const body = normalizedRows.slice(1);
    const lines = [];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${header.map(() => '----').join(' | ')} |`);
    body.forEach((row) => {
        lines.push(`| ${row.join(' | ')} |`);
    });
    lines.push('');
    return lines;
}
function isTocHeading(text) {
    return /^目录$/i.test(String(text || '').trim());
}
function isTocStyle(style) {
    return /^(toc|TOC)\d*$|目录\s*\d*/i.test(String(style || '').trim());
}
function isLikelyTocEntry(text, style) {
    const trimmed = String(text || '').trim();
    if (!trimmed)
        return true;
    if (isTocStyle(style))
        return true;
    if (/[\.\u2026·]{2,}\s*\d+\s*$/.test(trimmed))
        return true;
    if (/^(第[一二三四五六七八九十]+章|\d+(?:\.\d+){1,3})\s*.+\d+\s*$/.test(trimmed))
        return true;
    return false;
}
function isBodyHeadingAfterToc(text, style) {
    const trimmed = String(text || '').trim();
    if (!trimmed || isLikelyTocEntry(trimmed, style))
        return false;
    if (/^第[一二三四五六七八九十]+章\s+/.test(trimmed))
        return true;
    if (/^(参考文献|致谢|附录)$/i.test(trimmed))
        return true;
    if (/heading\s*1|title1|标题1|标题 1/i.test(style))
        return true;
    return false;
}
function isFigureCaption(text) {
    return /^图\s*\d+(?:-\d+)+\s+.+\S\s*$/.test(String(text || '').trim());
}
async function ingestDocx(inputPath, options) {
    const zip = await JSZip.loadAsync(fs.readFileSync(inputPath));
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
        throw new Error('DOCX 缺少 word/document.xml');
    }
    const documentXml = await documentFile.async('string');
    const relsFile = zip.file('word/_rels/document.xml.rels');
    const rels = relsFile ? parseRelationships(await relsFile.async('string')) : new Map();
    const assetsDir = path.join(path.dirname(options.output), options.assetsDir || 'thesis-assets');
    ensureDir(assetsDir);
    const lines = [];
    const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
    let match;
    let imageIndex = 0;
    let tableCount = 0;
    let skippingImportedToc = false;
    let skippedTocBlocks = 0;
    const pendingImageCaptions = [];
    let generatedImageCaptions = 0;
    let matchedImageCaptions = 0;
    function flushPendingImageCaptions() {
        while (pendingImageCaptions.length) {
            const pending = pendingImageCaptions.shift();
            if (pending.hasCaption)
                continue;
            lines.push(`图0-${pending.index}  导入图片${pending.index}`);
            lines.push('');
            generatedImageCaptions += 1;
        }
    }
    while ((match = blockRe.exec(documentXml)) !== null) {
        const blockXml = match[0];
        if (blockXml.startsWith('<w:tbl')) {
            if (skippingImportedToc) {
                skippedTocBlocks += 1;
                continue;
            }
            flushPendingImageCaptions();
            tableCount += 1;
            lines.push(...tableToMarkdown(blockXml));
            continue;
        }
        const pXml = blockXml;
        const text = paragraphText(pXml);
        const style = paragraphStyle(pXml);
        const rIds = extractImageRIds(pXml);
        if (isTocHeading(text)) {
            flushPendingImageCaptions();
            lines.push('## 目录');
            lines.push('');
            skippingImportedToc = true;
            continue;
        }
        if (skippingImportedToc) {
            if (!isBodyHeadingAfterToc(text, style)) {
                skippedTocBlocks += 1;
                continue;
            }
            skippingImportedToc = false;
        }
        if (text) {
            const prefix = guessHeadingPrefix(text, style);
            if (pendingImageCaptions.length && isFigureCaption(text)) {
                pendingImageCaptions.shift().hasCaption = true;
                matchedImageCaptions += 1;
            }
            else if (pendingImageCaptions.length || prefix || rIds.length) {
                flushPendingImageCaptions();
            }
            lines.push(`${prefix}${normalizeKeywordMarkdown(text)}`);
            lines.push('');
        }
        for (const rId of rIds) {
            const target = rels.get(rId);
            if (!target)
                continue;
            const normalizedTarget = target.replace(/^\.\.\//, '');
            const mediaPath = normalizedTarget.startsWith('word/') ? normalizedTarget : `word/${normalizedTarget}`;
            const file = zip.file(mediaPath);
            if (!file)
                continue;
            imageIndex += 1;
            const ext = path.extname(mediaPath) || '.png';
            const outName = `imported-fig-${String(imageIndex).padStart(2, '0')}${ext}`;
            const outPath = path.join(assetsDir, outName);
            fs.writeFileSync(outPath, await file.async('nodebuffer'));
            const relPath = path.relative(path.dirname(options.output), outPath).split(path.sep).join('/');
            lines.push(`![导入图片${imageIndex}](${relPath})`);
            lines.push('');
            pendingImageCaptions.push({ index: imageIndex, hasCaption: false });
        }
    }
    flushPendingImageCaptions();
    return {
        markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n'),
        warnings: [
            'DOCX 导入使用启发式标题识别，请检查标题层级、图题和表题编号。',
            tableCount > 0 ? `已导入 ${tableCount} 个 Word 表格为 Markdown 表格，请复核合并单元格和复杂表头。` : '未检测到 Word 表格。',
            skippedTocBlocks > 0 ? `已跳过源 DOCX 中 ${skippedTocBlocks} 个目录内容块，仅保留 Markdown 的 ## 目录占位。` : '未检测到需要跳过的源目录内容。',
            `图片题注检测：匹配源图题 ${matchedImageCaptions} 个，生成占位图题 ${generatedImageCaptions} 个。`,
        ],
    };
}
function ingestText(inputPath) {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const lines = raw.split(/\r?\n/).map((line) => line.trimEnd());
    return {
        markdown: `${lines.join('\n')}\n`,
        warnings: ['TXT 导入不会自动识别复杂标题、图表和公式，请人工复核 Markdown 结构。'],
    };
}
function ingestMarkdown(inputPath) {
    return {
        markdown: fs.readFileSync(inputPath, 'utf-8').replace(/\s*$/, '\n'),
        warnings: [],
    };
}
function ingestPdf(inputPath) {
    const candidates = [
        ['pdftotext', ['-layout', inputPath, '-']],
        ['mutool', ['draw', '-F', 'txt', inputPath]],
    ];
    for (const [command, args] of candidates) {
        const result = spawnSync(command, args, { encoding: 'utf-8' });
        if (result.status === 0 && result.stdout && result.stdout.trim()) {
            return {
                markdown: `${result.stdout.trim()}\n`,
                warnings: [`PDF 已通过 ${command} 提取为纯文本，请人工复核段落、标题、公式和表格。`],
            };
        }
    }
    throw new Error('当前环境缺少可用的 PDF 文本提取工具（pdftotext/mutool），请先转为 docx/txt/md。');
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const input = args.input || args.content || args._[0];
    if (!input) {
        console.error('Usage: node scripts/ingest_content.js --input <content.md|txt|docx|pdf> --output thesis.md [--mode format-only|polish]');
        process.exit(1);
    }
    const inputPath = path.resolve(input);
    const output = path.resolve(args.output || 'thesis.md');
    const mode = args.mode || 'format-only';
    if (!['format-only', 'polish'].includes(mode)) {
        console.error('mode 只能是 format-only 或 polish。');
        process.exit(2);
    }
    if (!fs.existsSync(inputPath)) {
        console.error(`内容文件不存在: ${inputPath}`);
        process.exit(2);
    }
    ensureDir(path.dirname(output));
    const ext = path.extname(inputPath).toLowerCase();
    let result;
    if (ext === '.md' || ext === '.markdown') {
        result = ingestMarkdown(inputPath);
    }
    else if (ext === '.txt') {
        result = ingestText(inputPath);
    }
    else if (ext === '.docx') {
        result = await ingestDocx(inputPath, { output, assetsDir: args['assets-dir'] });
    }
    else if (ext === '.pdf') {
        result = ingestPdf(inputPath);
    }
    else {
        console.error(`暂不支持的内容文件类型: ${ext}`);
        process.exit(2);
    }
    const header = [
        '<!--',
        `source: ${inputPath}`,
        `mode: ${mode}`,
        'edit-policy: 修改内容时只编辑本 Markdown；修改格式时编辑 thesis-format.json。',
        mode === 'format-only' ? 'format-only: 已按要求保留原文内容，未主动润色。' : 'polish: 允许后续在用户确认后润色论文文本。',
        '-->',
        '',
    ].join('\n');
    fs.writeFileSync(output, `${header}${result.markdown}`, 'utf-8');
    const reportPath = output.replace(/\.md$/i, '.ingest-report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify({
        input: inputPath,
        output,
        mode,
        warnings: result.warnings,
    }, null, 2)}\n`, 'utf-8');
    console.log(`markdown=${output}`);
    console.log(`report=${reportPath}`);
    result.warnings.forEach((warning) => console.log(`[warn] ${warning}`));
}
main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});
