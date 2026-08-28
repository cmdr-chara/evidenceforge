import { ToolResult } from "../../domain/src/types";

export interface SandboxCommand {
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
  network: "RESTRICTED" | "DISABLED" | "REQUIRED";
  maxOutputBytes: number;
}

export interface SandboxPort {
  run(command: SandboxCommand): Promise<ToolResult>;
}

export function validateSandboxCommand(command: SandboxCommand): SandboxCommand {
  if (command.argv.length === 0) throw new Error("sandbox argv cannot be empty");
  if (command.timeoutSeconds < 1 || command.timeoutSeconds > 900) {
    throw new Error("sandbox timeout must be between 1 and 900 seconds");
  }
  if (command.maxOutputBytes < 1024 || command.maxOutputBytes > 1_000_000) {
    throw new Error("sandbox output bound must be between 1KB and 1MB");
  }
  const executable = command.argv[0]?.toLowerCase();
  if (executable === "sudo") throw new Error("sudo is forbidden in the sandbox policy");
  return command;
}
