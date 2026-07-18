import {
    readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
    unlinkSync, statSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

function getProjectHash(): string {
    return createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
}

export function getMemoryDir(): string {
    const dir = join(homedir(), ".mini-claude", "projects", getProjectHash(), "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}