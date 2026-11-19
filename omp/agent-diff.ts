// Runs agent-diff around each omp run. Install: copy to ~/.omp/agent/extensions/
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const bin = `${process.env.HOME}/.local/bin/agent-diff`;

function run(cmd: string, ctx: { cwd: string; agent?: { kind?: string } }) {
	// Subagents load extensions too. Skip them so they do not reset the snapshot mid-run.
	if (ctx.agent?.kind === "sub") return;
	try {
		execFileSync(bin, [cmd, ctx.cwd], { stdio: "ignore" });
	} catch {} // a review is optional: never break the agent run
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (_e, ctx) => run("snapshot", ctx));
	pi.on("agent_end", (_e, ctx) => run("done", ctx));
}
