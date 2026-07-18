import Anthropic from "@anthropic-ai/sdk";
import { printToolCall, printToolResult } from "./ui.js";
import { toolDefinitions, executeTool } from "./tools.js";

export class Agent {
    private client: Anthropic;
    private messages: Anthropic.MessageParam[] = [];

    constructor() {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            baseURL: process.env.ANTHROPIC_BASE_URL,
        });
    }

    async chat(userMessages: string): Promise<void> {
        this.messages.push({ role: "user", content: userMessages });
        console.log(this.messages);
        console.log("****************");
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
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
            }

            this.messages.push({ role: "user", content: toolResults });
            console.log(this.messages);
            console.log("****************");
        }
    }
}
