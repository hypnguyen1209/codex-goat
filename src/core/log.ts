const NO_COLOR = Boolean(process.env.NO_COLOR) || process.env.TERM === "dumb";
const TTY = process.stderr.isTTY === true;
const useColor = TTY && !NO_COLOR;

function paint(code: string, text: string): string {
  return useColor ? `[${code}m${text}[0m` : text;
}

export const color = {
  dim: (s: string) => paint("2", s),
  bold: (s: string) => paint("1", s),
  red: (s: string) => paint("31", s),
  green: (s: string) => paint("32", s),
  yellow: (s: string) => paint("33", s),
  cyan: (s: string) => paint("36", s),
};

const TAG = color.cyan("goat");

// `goat status | head -3` closes the pipe while we are still writing, and an unhandled
// EPIPE on stdout crashes the process with a stack trace. Piping into `head`, `grep -q`
// or `less` is ordinary use; the reader going away is not our error to report.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

export const log = {
  info(message: string): void {
    process.stderr.write(`${TAG} ${message}\n`);
  },
  ok(message: string): void {
    process.stderr.write(`${TAG} ${color.green("ok")} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${TAG} ${color.yellow("warn")} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${TAG} ${color.red("error")} ${message}\n`);
  },
  detail(message: string): void {
    process.stderr.write(`     ${color.dim(message)}\n`);
  },
  /** Machine-readable output always goes to stdout so it can be piped. */
  out(message: string): void {
    process.stdout.write(`${message}\n`);
  },
};

export class GoatError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "GoatError";
    this.hint = hint;
  }
}
