#!/usr/bin/env node
import {
  PILOT_OUTPUT_PATH,
  applyAntiplateletStagingProvisioningPlan,
  buildAntiplateletStagingProvisioningPlan,
  rollbackAntiplateletStagingProvisioningPlan,
  verifyAntiplateletStagingProvisioningPlan
} from "../services/ops/src/pilot-provisioning.js";
import { stableStringify } from "../packages/connector-sdk/src/hash.js";

const args = new Set(process.argv.slice(2));
const outputPath = process.env.PHARMAOPS_PILOT_PROVISION_OUT ?? PILOT_OUTPUT_PATH;
const actor = process.env.PHARMAOPS_PROVISION_ACTOR ?? "user:platform-admin:pilot-provisioner";

if (args.has("--apply") && args.has("--rollback")) {
  throw new Error("choose either --apply or --rollback");
}

if (args.has("--rollback")) {
  const result = await rollbackAntiplateletStagingProvisioningPlan({ outputPath });
  console.log(stableStringify(result));
} else if (args.has("--verify")) {
  const result = await verifyAntiplateletStagingProvisioningPlan({ outputPath });
  console.log(stableStringify({
    output_path: result.output_path,
    verified: true,
    plan_digest: result.plan.plan_digest
  }));
} else if (args.has("--apply")) {
  const result = await applyAntiplateletStagingProvisioningPlan({ outputPath, actor });
  console.log(stableStringify({
    output_path: result.output_path,
    applied: true,
    plan_digest: result.plan.plan_digest
  }));
} else {
  const plan = buildAntiplateletStagingProvisioningPlan({ actor, mode: "dry-run" });
  console.log(stableStringify(plan));
}
