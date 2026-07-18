# Commit 53f32a0: add agent_loop

## 概述

提交信息：`add agent_loop`

**功能特性**：实现了基于工具调用的多轮对话循环（agent_loop）框架，支持上下文窗口压缩以防止对话历史过长超出 Token 限制。

## 变更文件

### 1. `package.json` (修改)
添加了 `glob` 依赖用于文件匹配：
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.110.0",
    "chalk": "^5.6.2",
    "glob": "^13.0.6",
    "openai": "^6.45.0"
  }
}
```

### 2. `package-lock.json` (修改)
锁定了 `glob` 及其依赖项（brace-expansion, balanced-match, lru-cache, minimatch, minipass, path-scurry）。

### 3. `src/agent.ts` (修改，从 132 行增加到 47 行)

**主要变更**：

1. **新增导入**：
   ```typescript
   import { printToolCall, printToolResult } from "./ui.js";
   import { toolDefinitions, executeTool } from "./tools.js";
   ```

2. **重命名方法**：`chatOnce` → `chat`

3. **实现完整的工具调用循环**：
   ```typescript
   async chat(userMessages: string): Promise<void> {
       this.messages.push({ role: "user", content: userMessages });
       while (true) {
           const response = await this.client.messages.create({
               model: "glm-4.7-flash",
               max_tokens: 4096,
               messages: this.messages,
               tools: toolDefinitions,
           });

           this.messages.push({ role: "assistant", content: response.content });

           const toolUses = response.content.filter(t => t.type === "tool_use");
           if (toolUses.length === 0) break;

           const toolResults: Anthropic.ContentBlockParam[] = [];
           for (const toolUse of toolUses) {
               const input = toolUse.input as Record<string, any>;
               printToolCall(toolUse.name, input);
               const result = await executeTool(toolUse.name, input);
               printToolResult(toolUse.name, result);
               toolResults.push({
                   type: "tool_result",
                   tool_use_id: toolUse.id,
                   content: result
               });
           }

           this.messages.push({ role: "user", content: toolResults });
       }
   }
   ```

### 4. `src/index.ts` (修改)

修改测试消息：
```typescript
// 之前
agent.chatOnce("你是什么模型？你能做什么事情？");

// 之后
agent.chat("当前代码仓中'src\\ui.ts'文件有什么内容？");
```

### 5. `src/memory.ts` (新增，17 行)

实现了项目级内存管理系统：

**核心功能**：
- 使用项目根目录的 SHA256 哈希作为唯一标识
- 内存存储在 `~/.mini-claude/projects/{projectHash}/memory/` 目录
- 自动创建内存目录结构
- 支持构建 MEMORY.md 索引文件

```typescript
function getProjectHash(): string {
    return createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
}

export function getMemoryDir(): string {
    const dir = join(homedir(), ".mini-claude", "projects", getProjectHash(), "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}
```

### 6. `src/tools.ts` (新增，405 行)

实现了完整的工具系统，包含以下工具：

#### 工具定义

| 工具名 | 描述 |
|--------|------|
| `read_file` | 读取文件内容，显示行号 |
| `write_file` | 写入文件，自动创建目录，返回预览 |
| `edit_file` | 精确字符串替换，支持 Diff 显示 |
| `list_files` | 使用 glob 模式列出文件 |
| `grep_search` | 递归搜索文件内容 |
| `run_shell` | 执行 shell 命令 |

#### 工具执行函数

**`executeTool(name, input, readFileState?)`**
- 根据 `name` 分发到相应的工具函数
- 支持 `readFileState` 参数缓存读取状态（防止循环读取）

**工具实现详情**：

1. **`readFile(file_path)`**
   - 读取文件内容，每行添加行号
   - 格式：`   1 | 内容`

2. **`writeFile(file_path, content)`**
   - 自动创建目录
   - 写入成功后自动更新 memory 索引
   - 返回文件统计和前 30 行预览

3. **`editFile(file_path, old_string, new_string)`**
   - 支持引号规范化（匹配时自动转换花括号引号）
   - 使用 split/join 避免 `$` 特殊字符问题
   - 生成 Diff 格式输出：
     ```
     @@ -行号,行数 +行号,行数 @@
     - 被删除的行
     + 新增的行
     ```

4. **`listFiles(pattern, path?)`**
   - 使用 `glob` 库进行文件匹配
   - 忽略 `node_modules/**` 和 `.git/**`
   - 最多返回 200 个文件

5. **`grepSearch(pattern, path?, include?)`**
   - Linux/macOS: 使用系统 `grep` 命令
   - Windows: 使用纯 JS 实现
   - 支持文件类型过滤
   - 最多返回 100 个匹配结果

6. **`runShell(command, timeout?)`**
   - 超时默认 30000ms
   - 支持 PowerShell (Windows) 和 sh (Linux/macOS)
   - 返回 stdout/stderr
   - 正确处理超时信号

**辅助函数**：
- `normalizeQuotes()`: 标准化引号（花括号引号 → 直角引号）
- `findActualString()`: 查找字符串，支持引号规范化
- `generateDiff()`: 生成 Diff 输出
- `grepJS()`: Windows 下的纯 JS grep 实现
- `autoUpdateMemoryIndex()`: 写入文件时自动更新 MEMORY.md

### 7. `src/ui.ts` (新增，92 行)

增强了 UI 辅助函数：

**`printToolCall(name, input)`**
- 显示工具调用图标和简要信息
- 支持多种工具的视觉标识

**`printToolResult(name, result)`**
- **特殊处理**：`edit_file` 和 `write_file` 显示彩色 Diff/预览
- 普通结果最多显示 500 字符，超出截断
- 支持文件变更的详细显示（Diff 格式）

**`printFileChangeResult(name, result)`**
- 首行显示成功消息（灰色）
- 接下来最多显示 40 行
- Diff 格式高亮：
  - `@@ ... @@`: 青色（Diff 头部）
  - `- 内容`: 红色（删除的行）
  - `+ 内容`: 绿色（新增的行）
  - 其他：灰色（内容预览）
- 显示剩余行数

**`getToolIcon(name)`**
- 为不同工具提供图标映射
- 默认图标：📖（读取）、✏️（写入）、🔧（编辑）、📁（列表）、🔍（搜索）、💻（执行）

**`getToolSummary(name, input)`**
- 生成工具调用的简要描述
- 根据不同工具类型格式化输入参数

## 技术要点

### 1. **上下文窗口管理**
```typescript
private async checkAndCompact(): Promise<void> {
    if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
        printInfo("Context window filling up, compacting conversation...");
        await this.compactConversation();
    }
}
```
当对话历史接近限制时自动压缩，保持对话质量。

### 2. **对话摘要生成**
使用 LLM 自动生成对话摘要，保留关键决策和上下文信息。

### 3. **完整的工具调用循环**
实现了真正的工具执行机制：
```typescript
for (const toolUse of toolUses) {
    printToolCall(toolUse.name, input);
    const result = await executeTool(toolUse.name, input);
    printToolResult(toolUse.name, result);
    toolResults.push({ type: "tool_result", ... });
}
```

### 4. **文件编辑 Diff 显示**
生成并显示清晰的 Diff 格式输出，帮助用户理解修改内容。

### 5. **跨平台文件操作**
- Windows: 使用 `execSync` + PowerShell
- Linux/macOS: 使用 `execSync` + sh/grep

### 6. **内存管理系统**
基于项目哈希的持久化内存存储，支持自动索引更新。

## 代码结构

```
Agent
├── Client 管理
│   ├── anthropicClient (可选)
│   ├── openaiClient (可选)
│   └── useOpenAI (模型切换)
├── 状态管理
│   ├── totalInputTokens
│   ├── totalOutputTokens
│   └── lastInputTokenCount
├── 上下文窗口管理
│   ├── effectiveWindow
│   ├── checkAndCompact()
│   ├── compactConversation()
│   ├── compactAnthropic()
│   └── compactOpenAI()
└── 对话循环
    └── chat() ← 新增完整工具调用逻辑
```

## 工具系统

### 工具类型
- **文件操作**: read_file, write_file, edit_file
- **搜索**: list_files, grep_search
- **执行**: run_shell

### 支持的 Glob 模式
- `**/*.ts` - 递归匹配 TypeScript 文件
- `src/**/*` - 匹配 src 目录下所有文件
- `*.md` - 匹配 Markdown 文件

## 作者信息

- **Commit ID**: `53f32a01071d8d36586bbbea9655029bb5591da0`
- **作者**: Shoppin <biubiubiuboom748@gmail.com>
- **日期**: 2026年7月7日 00:41:51 +0800
