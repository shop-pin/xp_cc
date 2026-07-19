import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { glob } from "glob";
import { dirname, join, basename, extname, resolve } from "path";
import { homedir } from "os";
import { getMemoryDir } from "./memory.js";

const isWin = process.platform === "win32";
export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk" | "auto";
const READ_TOOLS = new Set(["read_file", "list_file", "grep_search", "web_fetch"]);
const EDIT_TOOLS = new Set(["write_file", "edit_file"]);
export const CONCURRENCY_SAFE_TOOLS = new Set(["read_file", "list_file", "grep_search", "web_fetch"]);
export type ToolDef = Anthropic.Tool & { deferred?: boolean };

export const toolDefinitions: ToolDef[] = [
    {
        name: "read_file",
        description:
            "Read the contents of a file. Returns the file content with line numbers.",
        input_schema: {
            type: "object" as const,
            properties: {
                file_path: {
                    type: "string",
                    description: "The path to the file to read"
                },
            },
            required: ["file_path"],
        },
    },
    {
        name: "write_file",
        description:
            "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
        input_schema: {
            type: "object" as const,
            properties: {
                file_path: {
                    type: "string",
                    description: "The path to the file to write",
                },
                content: {
                    type: "string",
                    description: "The content to write to the file",
                },
            },
            required: ["file_path", "content"],
        },
    },
    {
        name: "edit_file",
        description:
            "Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace and indentation).",
        input_schema: {
            type: "object" as const,
            properties: {
                file_path: {
                    type: "string",
                    description: "The path to the file to edit",
                },
                old_string: {
                    type: "string",
                    description: "The exact string to find and replace",
                },
                new_string: {
                    type: "string",
                    description: "The string to replace it with",
                },
            },
            required: ["file_path", "old_string", "new_string"],
        },
    },
    {
        name: "list_files",
        description:
            "List files matching a glob pattern. Returns matching file paths.",
        input_schema: {
            type: "object" as const,
            properties: {
                pattern: {
                    type: "string",
                    description:
                        'Glob pattern to match files (e.g., "**/*.ts", "src/**/*")',
                },
                path: {
                    type: "string",
                    description:
                        "Base directory to search from. Defaults to current directory.",
                },
            },
            required: ["pattern"],
        },
    },
    {
        name: "grep_search",
        description:
            "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
        input_schema: {
            type: "object" as const,
            properties: {
                pattern: {
                    type: "string",
                    description: "The regex pattern to search for",
                },
                path: {
                    type: "string",
                    description: "Directory or file to search in. Defaults to current directory.",
                },
                include: {
                    type: "string",
                    description:
                        'File glob pattern to include (e.g., "*.ts", "*.py")',
                },
            },
            required: ["pattern"],
        },
    },
    {
        name: "run_shell",
        description:
            "Execute a shell command and return its output. Use this for running tests, installing packages, git operations, etc.",
        input_schema: {
            type: "object" as const,
            properties: {
                command: {
                    type: "string",
                    description: "The shell command to execute",
                },
                timeout: {
                    type: "number",
                    description: "Timeout in milliseconds (default: 30000)",
                },
            },
            required: ["command"],
        },
    },
    {
        name: "skill",
        description:
            "Invoke a registered skill by name. Skills are prompt templates loaded from .claude/skills/. Returns the skill's resolved prompt to follow.",
        input_schema: {
            type: "object" as const,
            properties: {
                skill_name: {
                    type: "string",
                    description: "The name of the skill to invoke",
                },
                args: {
                    type: "string",
                    description: "Optional arguments to pass to the skill",
                },
            },
            required: ["skill_name"],
        },
    },
    {
        name: "web_fetch",
        description:
            "Fetch a URL and return its content as text. For HTML pages, tags are stripped to return readable text. For JSON/text responses, content is returned directly.",
        input_schema: {
            type: "object" as const,
            properties: {
                url: { type: "string", description: "The URL to fetch" },
                max_length: {
                    type: "number",
                    description: "Maximum content length in characters (default 50000)",
                },
            },
            required: ["url"],
        },
    },
    {
        name: "enter_plan_mode",
        description:
            "Enter plan mode to switch to a read-only planning phase. In plan mode, you can only read files and write to the plan file. Use this when you need to explore the codebase and design an implementation plan before making changes.",
        input_schema: {
            type: "object" as const,
            properties: {},
        },
        deferred: true,
    },
    {
        name: "exit_plan_mode",
        description:
            "Exit plan mode after you have finished writing your plan to the plan file. The user will review and approve the plan before you proceed with implementation.",
        input_schema: {
            type: "object" as const,
            properties: {},
        },
        deferred: true,
    },
    {
        name: "agent",
        description:
            "Launch a sub-agent to handle a task autonomously. Sub-agents have isolated context and return their result. Types: 'explore' (read-only, fast search), 'plan' (read-only, structured planning), 'general' (full tools).",
        input_schema: {
            type: "object" as const,
            properties: {
                description: {
                    type: "string",
                    description: "Short (3-5 word) description of the sub-agent's task",
                },
                prompt: {
                    type: "string",
                    description: "Detailed task instructions for the sub-agent",
                },
                type: {
                    type: "string",
                    enum: ["explore", "plan", "general"],
                    description: "Agent type: explore (read-only), plan (planning), general (full tools). Default: general",
                },
            },
            required: ["description", "prompt"],
        },
    },
    {
        name: "tool_search",
        description:
            "Search for available tools by name or keyword. Returns full schema definitions for matching deferred tools so you can use them.",
        input_schema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "Tool name or search keywords"
                },
            },
            required: ["query"],
        },
    },
]

function readFile(input: { file_path: string }): string {
    try {
        const content = readFileSync(input.file_path, "utf-8");
        const lines = content.split("\n");
        const numbered = lines
            .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
            .join("\n");
        return numbered;
    } catch (e: any) {
        return `Error reading file: ${e.message}`;
    }
}

function autoUpdateMemoryIndex(filePath: string): void {
  try {
    const memDir = getMemoryDir();
    if (filePath.startsWith(memDir) && filePath.endsWith(".md") && !filePath.endsWith("MEMORY.md")) {
      // Rebuild the index from all memory files. NOTE: must use the ESM
      // import from the top of this file — `require()` does not exist at
      // runtime in ESM, and the throw was silently swallowed by the outer
      // catch, so the index was never rebuilt.
      const files = readdirSync(memDir).filter(
        (f: string) => f.endsWith(".md") && f !== "MEMORY.md"
      );
      const lines = ["# Memory Index", ""];
      for (const file of files) {
        try {
          const raw = readFileSync(join(memDir, file), "utf-8");
          const nameMatch = raw.match(/^name:\s*(.+)$/m);
          const typeMatch = raw.match(/^type:\s*(.+)$/m);
          const descMatch = raw.match(/^description:\s*(.+)$/m);
          if (nameMatch && typeMatch) {
            lines.push(`- **[${nameMatch[1].trim()}](${file})** (${typeMatch[1].trim()}) — ${descMatch?.[1]?.trim() || ""}`);
          }
        } catch { /* skip */ }
      }
      writeFileSync(join(memDir, "MEMORY.md"), lines.join("\n"));
    }
  } catch { /* non-critical */ }
}

function writeFile(input: { file_path: string; content: string }): string {
    try {
        const dir = dirname(input.file_path);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(input.file_path, input.content);
        autoUpdateMemoryIndex(input.file_path);
        const lines = input.content.split("\n");
        const lineCount = lines.length;
        const preview = lines.slice(0, 30).map((line, i) =>
            `${String(i + 1).padStart(4)} | ${line}`).join("\n");
        const truncNote = lineCount > 30 ? `\n ... (${lineCount} lines total)` : "";
        return `Successfully wrote to ${input.file_path} (${lineCount} lines)\n\n${preview}${truncNote}`;
    } catch (e: any) {
        return `Error writing file: ${e.message}`;
    }
}

export async function executeTool(
    name: string,
    input: Record<string, any>,
    readFileState?: Map<string, number>
): Promise<string> {
    let result: string;
    switch (name) {
        case "read_file":
            result = readFile(input as { file_path: string });
            break;
        case "write_file":
            result = writeFile(input as { file_path: string; content: string });
            break;
        case "edit_file":
            result = editFile(input as { file_path: string; old_string: string; new_string: string });
            break;
        case "list_files":
            result = await listFiles(input as { pattern: string; path?: string });
            break;
        case "grep_search":
            result = grepSearch(input as { pattern: string; path?: string; include?: string });
            break;
        case "run_shell":
            result = runShell(input as { command: string; timeout?: number });
            break;
        default:
            return `Unknown tool: ${name}`;
    }
    return result;
}

function editFile(input: {
    file_path: string;
    old_string: string;
    new_string: string;
}): string {
    try {
        const content = readFileSync(input.file_path, "utf-8");

        // Find the actual string (with quote normalization fallback)
        const actual = findActualString(content, input.old_string);
        if (!actual) {
            return `Error: old_string not found in ${input.file_path}`;
        }

        const count = content.split(actual).length - 1;
        if (count > 1)
            return `Error: old_string found ${count} times in ${input.file_path}. Must be unique.`;

        // Use split/join to avoid $ special chars in String.replace()
        const newContent = content.split(actual).join(input.new_string);
        writeFileSync(input.file_path, newContent);

        // Generate diff for result
        const diff = generateDiff(content, newContent, actual, input.new_string);
        const quoteNote = actual !== input.old_string ? " (matched via quote normalization)" : "";
        return `Successfully edited ${input.file_path}${quoteNote}\n\n${diff}`;
    } catch (e: any) {
        return `Error editing file: ${e.message}`;
    }
}

async function listFiles(input: {
    pattern: string;
    path?: string;
}): Promise<string> {
    try {
        const files = await glob(input.pattern, {
            cwd: input.path || process.cwd(),
            nodir: true,
            ignore: ["node_modules/**", ".git/**"],
        });
        if (files.length === 0) return "No files found matching the pattern.";
        return files.slice(0, 200).join("\n") +
            (files.length > 200 ? `\n... and ${files.length - 200} more` : "");
    } catch (e: any) {
        return `Error listing files: ${e.message}`;
    }
}

function grepSearch(input: {
    pattern: string;
    path?: string;
    include?: string;
}): string {
    // Try system grep first (available on Linux/macOS and Windows with Git in PATH)
    if (!isWin) {
        try {
            const args = ["--line-number", "--color=never", "-r"];
            if (input.include) args.push(`--include=${input.include}`);
            args.push("--", input.pattern);
            args.push(input.path || ".");
            const result = execFileSync("grep", args, {
                encoding: "utf-8",
                maxBuffer: 10 * 1024 * 1024,
                timeout: 10000,
            });
            const lines = result.split("\n").filter(Boolean);
            return lines.slice(0, 100).join("\n") +
                (lines.length > 100 ? `\n... and ${lines.length - 100} more matches` : "");
        } catch (e: any) {
            if (e.status === 1) return "No matches found.";
            if (e.code === "ENOBUFS") {
                // Huge match sets overflow the exec buffer before we can slice —
                // return a usable error instead of a bare spawn failure.
                return "Error: too many matches to buffer; narrow the pattern, path, or include filter.";
            }
            return `Error: ${e.message}`;
        }
    }
    // Pure JS fallback for Windows
    return grepJS(input.pattern, input.path || ".", input.include);
}

function runShell(input: { command: string; timeout?: number }): string {
    try {
        const result = execSync(input.command, {
            encoding: "utf-8",
            maxBuffer: 5 * 1024 * 1024,
            timeout: input.timeout || 30000,
            stdio: ["pipe", "pipe", "pipe"],
            shell: isWin ? "powershell.exe" : "/bin/sh",
        });
        return result || "(no output)";
    } catch (e: any) {
        const stderr = e.stderr ? `\nStderr: ${e.stderr}` : "";
        const stdout = e.stdout ? `\nStdout: ${e.stdout}` : "";
        // Timeout kills leave status null — report it as a timeout like the
        // Python version instead of "exit code null"
        if (e.code === "ETIMEDOUT" || (e.signal === "SIGTERM" && e.status === null)) {
            return `Command timed out after ${input.timeout || 30000}ms${stdout}${stderr}`;
        }
        return `Command failed (exit code ${e.status})${stdout}${stderr}`;
    }
}

function normalizeQuotes(s: string): string {
    return s
        .replace(/[\u2018\u2019\u2032]/g, "'")   // curly single quotes, prime
        .replace(/[\u201C\u201D\u2033]/g, '"');   // curly double quotes, double prime
}

function findActualString(fileContent: string, searchString: string): string | null {
    // Direct match first (cheapest)
    if (fileContent.includes(searchString)) return searchString;
    // Try with normalized quotes
    const normSearch = normalizeQuotes(searchString);
    const normFile = normalizeQuotes(fileContent);
    const idx = normFile.indexOf(normSearch);
    if (idx !== -1) return fileContent.substring(idx, idx + searchString.length);
    return null;
}

function generateDiff(
    oldContent: string, _newContent: string,
    oldString: string, newString: string
): string {
    const beforeChange = oldContent.split(oldString)[0];
    const lineNum = (beforeChange.match(/\n/g) || []).length + 1;
    const oldLines = oldString.split("\n");
    const newLines = newString.split("\n");

    const parts: string[] = [`@@ -${lineNum},${oldLines.length} +${lineNum},${newLines.length} @@`];
    // Show removed lines
    for (const l of oldLines) parts.push(`- ${l}`);
    // Show added lines
    for (const l of newLines) parts.push(`+ ${l}`);

    return parts.join("\n");
}

function grepJS(pattern: string, dir: string, include?: string): string {
    let re: RegExp;
    try {
        re = new RegExp(pattern);
    } catch (e: any) {
        // A model-supplied bad regex must come back as a tool error string,
        // not crash the agent loop.
        return `Error: invalid regex pattern: ${e.message}`;
    }
    const includeRe = include ? new RegExp(include.replace(/\*/g, ".*").replace(/\?/g, ".")) : null;
    const matches: string[] = [];
    let extra = 0;
    function walk(d: string) {
        let entries: string[];
        try { entries = readdirSync(d); } catch { return; }
        for (const name of entries) {
            if (name.startsWith(".") || name === "node_modules") continue;
            const full = join(d, name);
            let st;
            try { st = statSync(full); } catch { continue; }
            if (st.isDirectory()) { walk(full); continue; }
            if (includeRe && !includeRe.test(name)) continue;
            try {
                const text = readFileSync(full, "utf-8");
                const lines = text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    if (re.test(lines[i])) {
                        // Show at most 100 matches, but keep counting so the model
                        // knows how many were omitted.
                        if (matches.length < 100) matches.push(`${full}:${i + 1}:${lines[i]}`);
                        else extra++;
                    }
                }
            } catch { }
        }
    }
    walk(dir);
    if (matches.length === 0) return "No matches found.";
    return matches.join("\n") +
        (extra ? `\n... and ${extra} more matches` : "");
}
