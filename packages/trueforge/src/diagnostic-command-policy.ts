const READ_ONLY_COMMANDS = new Set([
  "basename",
  "cat",
  "cmp",
  "comm",
  "cut",
  "diff",
  "dirname",
  "du",
  "file",
  "grep",
  "head",
  "jq",
  "ls",
  "pwd",
  "readlink",
  "realpath",
  "rg",
  "sha256sum",
  "stat",
  "tail",
  "tr",
  "wc",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "branch",
  "diff",
  "log",
  "ls-files",
  "name-rev",
  "rev-parse",
  "show",
  "status",
]);

/**
 * Accept a deliberately small shell grammar for parallel diagnostics. The
 * sandbox SDK exposes a shell command string rather than argv, so an allowlist
 * is the only fail-closed way to prevent a specialist from smuggling writes
 * through an otherwise valid sandbox.exec identity.
 */
export function isReadOnlyDiagnosticSandboxExec(argumentsJson: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return false;
  }
  const input = asRecord(parsed);
  const command = readString(input, "command");
  const cwd = readString(input, "cwd");
  if (command === undefined || cwd !== "/workspace/repository") return false;
  if (input.env !== undefined || input.environment !== undefined) return false;
  if (/[\r\n;&<>`$(){}]/.test(command)) return false;

  const pipeline = command.split("|").map((part) => shellWords(part));
  if (pipeline.length === 0 || pipeline.some((words) => words === undefined)) return false;
  return pipeline.every((words) => words !== undefined && isReadOnlyCommand(words));
}

function shellWords(input: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of input.trim()) {
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (word.length > 0) {
        words.push(word);
        word = "";
      }
      continue;
    }
    word += character;
  }
  if (escaped || quote !== undefined) return undefined;
  if (word.length > 0) words.push(word);
  return words.length === 0 ? undefined : words;
}

function isReadOnlyCommand(words: string[]): boolean {
  const executable = words[0];
  if (executable === undefined || executable.includes("/")) return false;
  if (executable === "git") return isReadOnlyGitCommand(words.slice(1));
  if (!READ_ONLY_COMMANDS.has(executable)) return false;
  if (executable === "rg" && words.some((word) => word === "--pre" || word.startsWith("--pre="))) {
    return false;
  }
  return true;
}

function isReadOnlyGitCommand(words: string[]): boolean {
  let index = 0;
  while (words[index] === "--no-pager" || words[index] === "--literal-pathspecs") index += 1;
  if (words[index] === "-C") index += 2;
  const subcommand = words[index];
  if (subcommand === undefined || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
  if (subcommand === "branch" && words.slice(index + 1).some((word) => word !== "--show-current")) {
    return false;
  }
  return !words.slice(index + 1).some(
    (word) =>
      word === "--ext-diff" ||
      word === "--textconv" ||
      word.startsWith("--output"),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
