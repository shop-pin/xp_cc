import chalk from "chalk";

export function printToolCall(name: string, input: Record<string, any>) {
    const icon = getToolIcon(name);
    const summary = getToolSummary(name, input);
    console.log(chalk.yellow(`\n  ${icon} ${name}`) + chalk.gray(` ${summary}`));
}

export function printToolResult(name: string, result: string) {
    // Edit/write results get special colorized display
    if ((name === "edit_file" || name === "write_file") && !result.startsWith("Error")) {
        printFileChangeResult(name, result);
        return;
    }
    const maxLen = 500;
    const truncated =
        result.length > maxLen
            ? result.slice(0, maxLen) + chalk.gray(`\n  ... (${result.length} chars total)`)
            : result;
    const lines = truncated.split("\n").map((l) => "  " + l);
    console.log(chalk.dim(lines.join("\n")));
}

function printFileChangeResult(name: string, result: string) {
    const lines = result.split("\n");
    // First line is the success message
    console.log(chalk.dim("  " + lines[0]));

    // Rest is content preview or diff
    const maxDisplayLines = 40;
    const contentLines = lines.slice(1);
    const displayLines = contentLines.slice(0, maxDisplayLines);

    for (const line of displayLines) {
        if (!line.trim()) continue;
        if (line.startsWith("@@")) {
            // Diff header
            console.log(chalk.cyan("  " + line));
        } else if (line.startsWith("- ")) {
            // Removed line
            console.log(chalk.red("  " + line));
        } else if (line.startsWith("+ ")) {
            // Added line
            console.log(chalk.green("  " + line));
        } else {
            // File content preview (line numbers)
            console.log(chalk.dim("  " + line));
        }
    }
    if (contentLines.length > maxDisplayLines) {
        console.log(chalk.gray(`  ... (${contentLines.length - maxDisplayLines} more lines)`));
    }
}

function getToolIcon(name: string): string {
    const icons: Record<string, string> = {
        read_file: "📖",
        write_file: "✏️",
        edit_file: "🔧",
        list_files: "📁",
        grep_search: "🔍",
        run_shell: "💻",
        skill: "⚡",
        agent: "🤖",
    };
    return icons[name] || "🔨";
}

function getToolSummary(name: string, input: Record<string, any>): string {
    switch (name) {
        case "read_file":
            return input.file_path;
        case "write_file":
            return input.file_path;
        case "edit_file":
            return input.file_path;
        case "list_files":
            return input.pattern;
        case "grep_search":
            return `"${input.pattern}" in ${input.path || "."}`;
        case "run_shell":
            return input.command.length > 60
                ? input.command.slice(0, 60) + "..."
                : input.command;
        case "skill":
            return input.skill_name;
        case "agent":
            return `[${input.type || "general"}] ${input.description || ""}`;
        default:
            return "";
    }
}