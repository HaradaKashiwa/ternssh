import { api } from "@/lib/api";

export interface GenerateCommandOptions {
  prompt: string;
  history?: string[];
  signal?: AbortSignal;
}

export class AiCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiCommandError";
  }
}

export async function generateShellCommand(
  options: GenerateCommandOptions,
): Promise<string> {
  const prompt = options.prompt.trim();
  if (!prompt) {
    throw new AiCommandError("Prompt is required");
  }

  try {
    const response = await api.generateAiCommand(
      {
        prompt,
        history: options.history,
      },
      { signal: options.signal },
    );
    return response.command;
  } catch (error) {
    if (error instanceof AiCommandError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("not a valid shell command")) {
      throw new AiCommandError("not-a-command");
    }
    throw new AiCommandError(
      message || "Failed to generate command",
    );
  }
}
