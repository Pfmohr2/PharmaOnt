#!/usr/bin/env node
import {
  applyPilotOnboarding,
  dryRunPilotOnboarding,
  verifyPilotOnboarding
} from "../services/ops/src/pilot-onboarding.js";
import { PILOT_OUTPUT_PATH } from "../services/ops/src/pilot-provisioning.js";
import { stableStringify } from "../packages/connector-sdk/src/hash.js";

const args = process.argv.slice(2);
const flags = new Set(args);
const rosterPath = valueAfter("--roster");
const statePath = process.env.PHARMAOPS_PILOT_PROVISION_OUT ?? valueAfter("--state") ?? PILOT_OUTPUT_PATH;

if (flags.has("--apply") && flags.has("--verify")) {
  throw new Error("choose either --apply or --verify");
}

if (flags.has("--verify")) {
  const result = await verifyPilotOnboarding({ statePath });
  console.log(stableStringify(result));
} else if (flags.has("--apply")) {
  const result = await applyPilotOnboarding({ rosterPath, statePath });
  console.log(stableStringify(result));
} else {
  const result = await dryRunPilotOnboarding({ rosterPath, statePath });
  console.log(stableStringify(result));
}

function valueAfter(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
