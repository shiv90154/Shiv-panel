#!/usr/bin/env node
// Runner started by update.apply (via systemd-run). Usage: update-run.mjs <full commit sha>. Config comes from UPDATE_* env set by the agent.
import { realIo, runUpdate, uCfg } from "./update.mjs";

const c = uCfg();
const ok = await runUpdate(c, process.argv[2] ?? "", realIo(c)).catch((e) => { console.error(e); return false; });
process.exit(ok ? 0 : 1);
