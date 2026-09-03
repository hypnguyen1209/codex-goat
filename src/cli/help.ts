import { color, log } from "../core/log.js";
import { STAGE_IDS, STAGES } from "../state/stages.js";

export function printHelp(): void {
  const stageLines = STAGE_IDS.map((id) => `    ${STAGES[id].invocation.padEnd(14)} ${STAGES[id].summary}`).join("\n");

  log.out(`${color.bold("codex-goat")} — a stronger default for OpenAI Codex CLI

${color.bold("Usage")}
  goat [goat-flags] [codex-args...]      launch Codex with stronger defaults
  goat <command> [options]

${color.bold("Launch flags")}
  --high | --xhigh | --medium | --low    reasoning effort (default: high)
  --effort <level>                       same, explicit form
  --madmax                               codex --dangerously-bypass-approvals-and-sandbox
  --worktree[=<name>] | -w <name>        run inside a dedicated git worktree
  --for <stage>                          launch the model that stage is routed to
  --no-goat-defaults                     forward argv to codex untouched
  --print-argv                           print the resolved codex command and exit
  --                                     everything after this goes to codex verbatim

${color.bold("Commands")}
  setup [--scope user|project] [--force] install skills, AGENTS guidance, and hooks
  doctor                                 check install shape (not auth)
  exec [--role <name>] "<prompt>"        non-interactive run; the real auth smoke test
  status                                 workflow state, reconciled against evidence
  contract [<stage>] [--json]            can this stage start right now, and what is missing
  state read|set|clear                   durable stage state under .goat/
  ledger read|evidence|note              append-only workflow record
  skills [--roles]                       list bundled stages, skills, and role prompts
  hook                                   run one lifecycle hook payload from stdin
  uninstall [--scope ...] [--purge-state]
  help | version

${color.bold("Canonical stages")} — invoke any of them on their own, in any order:
${stageLines}

${color.bold("A good first session")}
  npm install -g codex-goat
  goat setup --scope project
  goat doctor
  goat exec "Reply with exactly GOAT-OK"
  goat --worktree=feat/task --madmax --xhigh
`);
}
