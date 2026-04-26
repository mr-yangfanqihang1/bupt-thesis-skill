## bupt-thesis-skill

提供模板驱动的本科毕设论文 Markdown 自动化检查、格式抽取与 DOCX 渲染导出工具链（以 Agent Skill 形式提供）。

### 功能简述

- **模板解析**：读取用户上传的论文模板 DOCX，抽取页面、页眉页脚、标题、正文、目录、图表题注等格式，并生成可确认的格式摘要。
- **内容导入**：将 `md/docx/pdf/txt` 论文内容统一导入为 Markdown，形成后续维护的正文源。
- **结构化检查**: 对论文的标题层级、图表题注与编号、摘要格式等进行规范校验。
- **一键导出**: 基于 `thesis.md + thesis-format.json` 渲染为 DOCX 文件。
- **高级渲染支持**: 提供表格自动宽度分配、公式渲染、Mermaid/PlantUML 内联图表渲染等多种 Markdown 扩展功能。

### 目录结构

- `bupt-thesis-helper/scripts/`：核心 Node.js 脚本（包含模板解析、内容导入、结构检查、DOCX 渲染及封面组装等逻辑）。
- `bupt-thesis-helper/assets/`：配置例子；云端包不内置 DOCX/图片等二进制模板。
- `bupt-thesis-helper/references/`：关于排版、参考及各种写作规约的参考文档。
- `bupt-thesis-helper/SKILL.md`：详细描述了该 Skill 的工作流、调用指引以及前置条件，供 Agent 查阅参考。

### 快速使用

#### 1. 接入 Skill

将此技能仓库克隆或下载到本地，将`bupt-thesis-helper`目录配置至你的 Agent 环境中（具体方式视你使用的 Agent 产品而定，例如放入特定的技能文件夹、加入工作区上下文或通过指令导入）。
Agent 会自动读取 `bupt-thesis-helper/SKILL.md` 中的元数据、意图触发说明以及工作流设定。

#### 2. 对话调用

完成接入后，你只需用日常对话的方式向 Agent 下达处理指令。例如：
- “根据这个论文模板 DOCX 和论文内容生成格式摘要，让我确认后导出 DOCX。”
- “使用 bupt-thesis-helper 检查一下当前的 Markdown 论文格式是否有问题。”
- “只修改论文格式，不润色正文，然后导出 DOCX。”
- “我确认可以润色，请基于 Markdown 修改论文内容并重新导出 DOCX。”

### 模板驱动工作流

1. 初始化工作区：

```bash
node bupt-thesis-helper/scripts/init_project.js --template-docx <template.docx> --content <paper.md|docx|pdf|txt> --out-dir thesis-work --mode format-only
```

2. 确认或编辑：

- `thesis-work/format-summary.md`
- `thesis-work/thesis-format.json`
- `thesis-work/thesis.md`

3. 导出 DOCX：

```bash
node bupt-thesis-helper/scripts/md2doc.js --input thesis-work/thesis.md --template-docx <template.docx> --format-config thesis-work/thesis-format.json --output thesis.docx
```

原则：最终用户要的是 DOCX，但 agent 只修改 Markdown 和格式配置，不直接修改最终 DOCX。

### TypeScript 开发

脚本源码位于 `bupt-thesis-helper/src/*.ts`，运行入口位于 `bupt-thesis-helper/scripts/*.js`。修改脚本逻辑后需要重新编译：

```bash
cd bupt-thesis-helper
npm install
npm run build
```

生成云端上传包：

```bash
npm run package:cloud
```

云端包会排除 `.docx`、图片、PDF、`node_modules` 等二进制或大型目录，保留 `src/`、`scripts/`、依赖清单和说明文件。