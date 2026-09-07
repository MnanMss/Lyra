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
		"Never stop with a plain text question when a plan is in progress. If you need user input or decision to proceed with a todo item, call ask_user rather than narrating the question.",
	],
	description:
		"Ask the user a question with interactive choice options when you need human guidance, approval, or a decision between multiple technical paths. Call this tool when blocked instead of merely writing the question in assistant prose.",
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
		if (!ctx.requestApproval) {
			return { content: [{ type: "text", text: "This host cannot ask the user. No answer was received." }], isError: true };
		}
		const question = args.question.trim();
		const options = [...new Set(args.options.map((option) => option.trim()).filter(Boolean))];
		if (!question || (!options.length && !args.allowCustomInput)) {
			return { content: [{ type: "text", text: "Provide a question and at least one choice, or enable custom input." }], isError: true };
		}
		const decision = await ctx.requestApproval({
			kind: "interactive",
			title: "需要你的意见",
			detail: question,
			subject: "ask_user",
			options,
			allowCustomInput: args.allowCustomInput === true,
		});
		return {
			content: [{ type: "text", text: typeof decision === "object" ? decision.answer : "The question was cancelled or expired. No answer was received." }],
			isError: typeof decision !== "object",
		};
	},
};
