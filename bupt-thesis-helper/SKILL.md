---
name: bupt-thesis-helper
description: >-
  Build template-driven thesis DOCX files from a user-provided Word template
  and paper content. Use when checking thesis Markdown, importing docx/pdf/txt/md
  content, extracting formatting rules, or exporting a thesis to DOCX.
---

# bupt-thesis-helper

## Overview

用于模板驱动的论文格式修复、Markdown 检查、内容导入、格式抽取与 DOCX 导出。

适用场景：

- 从用户上传的模板 DOCX 中抽取页面、页眉页脚、标题、正文、目录、图表题注等格式
- 在 `format-only` 模式下复制并修复用户 DOCX，尽量保留源 Word 的分页、空段、题名页、表格和图片结构
- 在 `polish` / `generate` 模式下将用户论文内容（`md/docx/pdf/txt`）导入为可维护的 Markdown
- 生成 `format-summary.md` 供用户确认或编辑，再基于 `thesis.md + thesis-format.json` 导出最终 DOCX
- 用户要求改内容时使用 Markdown 工作流；用户只要求修格式时优先使用 DOCX 副本修复工作流；不要直接覆盖用户原始 DOCX

当前工具链使用 TypeScript 维护源码：`src/*.ts` 是开发源文件，`scripts/*.js` 是编译后的运行入口。云端和本地命令都调用 `scripts/*.js`。

## Agent Rules

1. **模板驱动优先。** 若用户提供模板 DOCX，先运行 `inspect_template_docx.js`，生成 `thesis-format.json` 与 `format-summary.md`，让用户确认或编辑格式摘要。
2. **非必要不要阅读全文。** 优先使用检查脚本输出、标题树、局部行号与局部片段定位问题；只有在脚本结果不足以判断时，才阅读原文局部内容。
3. **多级标题的“含义约定”由 LLM 复核。** 检查脚本只能抽取和校验标题结构；对于“这个标题层级是否符合我们当前约定”的判断，必须结合 `headings` 输出由 LLM 继续复核。
4. **双模式工作流。** `format-only + DOCX` 表示复制源 DOCX 后直接修格式，优先保留原 Word 视觉结构；`polish/generate` 表示使用 Markdown 作为内容源，适合 AI 改写、补写和重生成。
5. **区分格式整理与论文润色。** 用户选择 `format-only` 时保留原文表达，不主动润色；用户选择 `polish` 或 `generate` 时才允许改写论文文本。
6. **关注参考文献余量与补充 SOP。** 当用户显式要求补充参考文献，或者你观察到参考文献数量低于 20 个、近三年文献占比低于 30% 时，应主动询问用户是否需要帮忙补充文献。如果用户确认，在操作前**必须**前往查阅并遵循 \`bupt-thesis-helper/references/add-references.md\` 规范。
7. **目录页码异常先提示手动更新域。** 若用户反馈目录页码异常、但目录跳转仍正常，不要立刻判定导出逻辑错误；应先简要提示用户在 Word 中手动“更新整个目录”或全选后更新域重试，因为这类问题常与 Word 打开后的分页/域刷新时机有关。

## Dependencies

运行该 Skill 下的工具链需要配置 Node.js 并在当前上下文环境安装必要的 npm 包。作为 Agent，你应该自主判断或提示用户是否已安装这些包；如果环境缺失依赖，直接通过系统命令在恰当目录自行安装：

```bash
npm install docx jszip @xmldom/xmldom
```

开发或重新构建脚本时：

```bash
npm install
npm run build
```

依赖用途：

- `docx`：正文 DOCX 生成
- `jszip`：DOCX 包读写
- `@xmldom/xmldom`：封面注入与 XML 后处理
- `typescript`：将 `src/*.ts` 编译为 `scripts/*.js`

## Commands

### 1. 从模板 DOCX 抽取格式

```bash
node scripts/inspect_template_docx.js --template <template.docx> --format-out thesis-format.json --summary-out format-summary.md
```

### 2. 导入论文内容为 Markdown

```bash
node scripts/ingest_content.js --input <paper.md|paper.docx|paper.pdf|paper.txt> --output thesis.md --mode format-only
```

`--mode` 可选：

- `format-only`：只整理格式，不主动改动文本内容
- `polish`：允许在用户确认后润色论文文本
- `generate`：允许从材料生成或重组论文内容

注意：当用户提供的是 DOCX 且只要求 `format-only` 时，优先使用 `md2doc.js --content <paper.docx> --mode format-only`，该入口会直接复制并修复 DOCX，不经过 Markdown。

### 3. 初始化工作区

```bash
node scripts/init_project.js --template-docx <template.docx> --content <paper.md|docx|pdf|txt> --out-dir thesis-work --mode format-only
```

产物：

- `thesis-work/thesis.md`
- `thesis-work/thesis-format.json`
- `thesis-work/format-summary.md`

### 4. 结构检查

```bash
node scripts/check_markdown.js <markdown-path>
```

需要结构化标题树与问题清单时：

```bash
node scripts/check_markdown.js <markdown-path> --json
```

### 5. 只生成正文 DOCX

```bash
node scripts/generate_thesis.js --input <markdown-path> --format-config thesis-format.json --output <body-docx-path>
```

说明：

- `--input` 必填，不提供任何固定文件名回退
- `--output` 可省略，默认输出为“输入 Markdown 同目录下的同名 .docx”

### 6. 只组装封面与正文

```bash
node bupt-thesis-helper/scripts/compose_docx.js --cover <cover-docx-path> --body <body-docx-path> --output <final-docx-path> --cover-data <cover-json-path>
```

### 7. 一键导出最终 DOCX

```bash
node scripts/md2doc.js --input thesis.md --template-docx <template.docx> --format-config thesis-format.json --output <final-docx-path>
```

只修 DOCX 格式、尽量保留源 Word 版式：

```bash
node scripts/md2doc.js --content <paper.docx> --template-docx <template.docx> --mode format-only --output <fixed.docx>
```

预览可应用的 DOCX 修复项，不写出文件：

```bash
node scripts/md2doc.js --content <paper.docx> --format-config thesis-format.json --mode format-only --dry-run
```

只应用用户确认的修复项：

```bash
node scripts/md2doc.js --content <paper.docx> --format-config thesis-format.json --mode format-only --fix page,body,caption --output <fixed.docx>
```

需要润色或重生成正文：

```bash
node scripts/md2doc.js --content <paper.docx> --template-docx <template.docx> --mode polish --md-out thesis.md --output <final.docx>
```

可选参数：

- `--cover <cover-docx-path>`
- `--cover-data <cover-json-path>`
- `--content <paper.md|docx|pdf|txt>`
- `--mode format-only|polish|generate`
- `--dry-run`
- `--fix page,body,heading,caption,keyword,reference,citation,toc`
- `--refresh-format`
- `--skip-check`
- `--force`

说明：

- 若未指定 `--output`，默认输出为“输入 Markdown 同目录下的同名 `.docx`”
- 若未指定 `--cover`，脚本只导出正文 DOCX，不拼接封面二进制模板
- 若指定 `--content <docx>` 且 `--mode format-only`，脚本会直接复制并修复 DOCX 副本
- `format-only` 直修 DOCX 时，先用 `--dry-run` 展示修复项清单；用户确认后用 `--fix` 选择保留的修复项
- 其他 `--content` 场景会先导入内容到 Markdown，再执行检查和导出

## What the Check Script Covers

`check_markdown.js` 会做这些事情：

1. 提取完整多级标题
2. 校验一级/二级/三级标题格式、层级与编号顺序
3. 检查中文摘要与英文摘要是否满足 `<br> + 关键词` 规则
4. 检查普通图片是否存在、是否有下方题注
5. 检查普通表格是否有上方题注
6. 检查表格单元格内嵌图片是否存在、是否带同单元格题注
7. 检查图表编号唯一性，以及编号章号与当前位置是否一致
8. 将 Mermaid / PlantUML 类代码块按图片对象纳入题注检查

**重要：** 标题“结构正确”不等于“层级语义正确”。拿到 `headings` 输出后，LLM 仍需结合当前项目约定判断：这些多级标题是否真的该放在这一层。

## Convention over Configuration (约定大于配置)

本技能的一切检查、导出逻辑与特定的论文模板排版，都强依赖于深度的“命名约定与格式约定”（如：特定的专用标题名、固定的图表题注格式等）。
作为 Agent，在执行涉及论文修改、查错、调整排版和结构生成的操作前，你必须前往研读 \`bupt-thesis-helper/references/markdown-writing-spec.md\`，这是所有约定逻辑的唯一真理源。

## Recommended Workflow

### 场景 A：快速自检

1. 运行 `check_markdown.js <markdown-path> --json`
2. 优先阅读 `issues` 和 `headings`
3. 由 LLM 复核标题层级是否符合当前约定
4. 向用户汇总问题，并询问“是否开始修复”
5. 只有在需要定位具体上下文时，再阅读原文局部片段

### 场景 B：模板驱动初始化

1. 运行 `init_project.js --template-docx <模板.docx> --content <论文内容> --out-dir <工作目录>`
2. 打开 `format-summary.md`，向用户展示摘要并确认是否需要编辑
3. 用户确认后，后续内容修改只改 `thesis.md`，格式修改只改 `thesis-format.json`

### 场景 C：只修 DOCX 格式

1. 运行 `md2doc.js --content <论文.docx> --template-docx <模板.docx> --mode format-only --dry-run`
2. 向用户展示修复项清单，并询问要保留哪些项
3. 用 `--fix <items>` 只应用用户确认的修复项并输出 `<fixed.docx>`
4. 确认输出 DOCX 的题名页、目录、图表题注、参考文献和页眉页脚
5. 若需要改正文或润色，切换到 Markdown 工作流，不在 DOCX XML 中直接改写正文

DOCX 直修可选项：

- `page`：页面设置与页边距
- `body`：正文样式与 1.5 倍行距
- `heading`：标题样式
- `caption`：图表题注样式
- `keyword`：关键词标签加粗
- `reference`：参考文献编号与悬挂缩进
- `citation`：正文引用上角标与双向链接
- `toc`：目录/域更新

### 场景 D：准备导出

1. 运行检查
2. 确认无阻断错误，或用户明确允许 `--force`
3. 运行 `md2doc.js --input thesis.md --format-config thesis-format.json --output <final-docx-path>`
4. 打开结果，重点检查目录、标题、图表题注、公式和页眉页脚

### 场景 D：只想复核标题树

1. 运行 `check_markdown.js <markdown-path> --json`
2. 直接读取 `headings`
3. 非必要不要通读整篇论文

## Resources

- `scripts/check_markdown.js`：结构化检查与标题树提取
- `scripts/inspect_template_docx.js`：模板 DOCX 格式解析与摘要生成
- `scripts/ingest_content.js`：论文内容导入为 Markdown
- `scripts/init_project.js`：初始化模板驱动工作区
- `scripts/generate_thesis.js`：正文 DOCX 生成
- `scripts/compose_docx.js`：封面/声明与正文组装
- `scripts/md2doc.js`：总入口，串联检查、正文生成、最终组装
- `scripts/package_cloud_skill.js`：生成不含二进制文件的云端上传包
- `src/*.ts`：上述脚本的 TypeScript 源码，修改逻辑时优先改这里并运行 `npm run build`
- `references/markdown-writing-spec.md`：写作与导出规则说明
- `references/add-references.md`：参考文献补充 SOP
- `assets/thesis.cover.example.json`：封面信息模板

## Boundaries

- 云端 skill 包不要内置 `.docx/.png/.jpg/.pdf` 等二进制文件；模板 DOCX、论文内容和图片目录由用户每次上传
- 若检查存在错误，默认阻止导出；只有用户明确需要时才使用 `--force`
- 当前正文导出唯一来源为 `thesis.md + thesis-format.json + scripts/generate_thesis.js`
- 与论文内容语义相关的最终判断，优先依赖检查脚本输出 + LLM 复核，而不是直接通读全文
