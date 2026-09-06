import type { Tool, ToolContext, ToolResult } from "../types.ts";

interface AskUserArgs {
	question: string;
	options: string[];
	allowCustomInput?: boolean;
}

export const askUserTool: Tool<AskUserArgs> = {
	name: "ask_user",
	snippet: "Ask user for decision or assistance with choices",
	guidelines: [
		"Use ask_user whenever you need clarification, technical direction choice, confirmation, or assistance before proceeding.",
		"When ask_user is called, the loop pauses and shows an interactive option box for the user, preventing premature completion loops.",
	],
	description:
		"Ask the user a question with interactive choice options when you need human guidance, approval, or a decision between multiple technical paths.",
	parameters: {
		type: "object",
		properties: {
			question: {
				type: "string",
				description: "The question or explanation of what assistance you need from the user.",
			},
			options: {
				type: "array",
				items: { type: "string" },
				description: "List of actionable options the user can click to answer.",
			},
			allowCustomInput: {
				type: "boolean",
				description: "Whether the user can also supply custom free-form input.",
			},
		},
		required: ["question", "options"],
		additionalProperties: false,
	},
	summarize: (args) => `Ask user: ${args.question.slice(0, 40)}`,

	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		if (ctx.requestApproval) {
			const decision = await ctx.requestApproval({
				kind: "interactive",
				title: "模型请求决策协助",
				detail: args.question,
				subject: "ask_user",
				reason: args.question,
				options: args.options,
			});

			return {
				content: [
					{
						type: "text",
						text:
							decision === "reject"
								? "用户取消了选项确认，或选择自行在输入框输入回复。"
								: "已向用户展示选项卡片并等待交互。",
					},
				],
			};
		}

		return {
			content: [
				{
					type: "text",
					text: `[Interactive Question]\n${args.question}\nOptions:\n${args.options.map((o, idx) => `${idx + 1}. ${o}`).join("\n")}`,
				},
			],
		};
	},
};
