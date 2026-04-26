'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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
function runNodeScript(scriptPath, scriptArgs, options = {}) {
    const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
        cwd: options.cwd,
        stdio: 'inherit',
        env: { ...process.env, ...(options.env || {}) },
    });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}
function resolvePath(baseDir, inputPath) {
    return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}
function main() {
    const skillRoot = path.resolve(__dirname, '..');
    const args = parseArgs(process.argv.slice(2));
    const baseDir = path.resolve(args.workspace || process.cwd());
    const template = args.template || args['template-docx'];
    const content = args.content || args.input || args._[0];
    if (!template || !content) {
        console.error('Usage: node scripts/init_project.js --template-docx <template.docx> --content <paper.md|docx|pdf|txt> [--out-dir thesis-work] [--mode format-only|polish]');
        process.exit(1);
    }
    const outDir = resolvePath(baseDir, args['out-dir'] || 'thesis-work');
    fs.mkdirSync(outDir, { recursive: true });
    const templatePath = resolvePath(baseDir, template);
    const contentPath = resolvePath(baseDir, content);
    const mode = args.mode || 'format-only';
    const markdownPath = path.join(outDir, args['md-name'] || 'thesis.md');
    const formatPath = path.join(outDir, args['format-name'] || 'thesis-format.json');
    const summaryPath = path.join(outDir, args['summary-name'] || 'format-summary.md');
    const inspectorPath = path.resolve(skillRoot, 'scripts', 'inspect_template_docx.js');
    const ingesterPath = path.resolve(skillRoot, 'scripts', 'ingest_content.js');
    if (!fs.existsSync(templatePath)) {
        console.error(`模板 DOCX 不存在: ${templatePath}`);
        process.exit(2);
    }
    if (!fs.existsSync(contentPath)) {
        console.error(`论文内容文件不存在: ${contentPath}`);
        process.exit(2);
    }
    console.log('[1/2] 解析模板格式并生成摘要...');
    runNodeScript(inspectorPath, [
        '--template', templatePath,
        '--format-out', formatPath,
        '--summary-out', summaryPath,
    ], { cwd: outDir });
    console.log('[2/2] 导入论文内容为 Markdown...');
    runNodeScript(ingesterPath, [
        '--input', contentPath,
        '--output', markdownPath,
        '--mode', mode,
    ], { cwd: outDir });
    console.log('');
    console.log('初始化完成。请先确认或编辑以下文件：');
    console.log(`- Markdown 正文: ${markdownPath}`);
    console.log(`- 格式配置: ${formatPath}`);
    console.log(`- 格式摘要: ${summaryPath}`);
    console.log('');
    console.log('确认后可运行 md2doc.js 导出 DOCX。');
}
main();
