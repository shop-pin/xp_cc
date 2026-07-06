import Anthropic from "@anthropic-ai/sdk";

export class Agent {
    private client: Anthropic;
    private messages: Anthropic.MessageParam[] = [];

    constructor() {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            baseURL: process.env.ANTHROPIC_BASE_URL,
        });
    }

    async chatOnce(userMessages: string): Promise<void> {
        this.messages.push({role: "user", content: userMessages});

        const response = await this.client.messages.create({
            model: "glm-4.7-flash",
            max_tokens: 4096,
            messages: this.messages,
        });

        const text = response.content.find(b => b.type === "text")?.text ?? "";
        console.log(text);
        this.messages.push({ role: "assistant", content: response.content});
    }
}
