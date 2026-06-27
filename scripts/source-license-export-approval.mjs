#!/usr/bin/env node
import {
  PILOT_SOURCE_LICENSE_PACKET_PATH,
  applyPilotSourceLicenseApprovalPacket,
  buildPilotSourceLicenseApprovalPacket,
  rollbackPilotSourceLicenseApprovalPacket,
  verifyPilotSourceLicenseApprovalPacket
} from "../services/ops/src/source-license-export-approval.js";
import { stableStringify } from "../packages/connector-sdk/src/hash.js";

const args = new Set(process.argv.slice(2));
const outputPath = process.env.PHARMAOPS_SOURCE_LICENSE_PACKET_OUT ?? PILOT_SOURCE_LICENSE_PACKET_PATH;
const actor = process.env.PHARMAOPS_SOURCE_LICENSE_APPROVER ?? "user:compliance-legal:source-license-approver";

if (args.has("--apply") && args.has("--rollback")) {
  throw new Error("choose either --apply or --rollback");
}

if (args.has("--rollback")) {
  const result = await rollbackPilotSourceLicenseApprovalPacket({ outputPath });
  console.log(stableStringify(result));
} else if (args.has("--verify")) {
  const result = await verifyPilotSourceLicenseApprovalPacket({ outputPath });
  console.log(stableStringify({
    output_path: result.output_path,
    verified: true,
    packet_digest: result.packet.packet_digest
  }));
} else if (args.has("--apply")) {
  const result = await applyPilotSourceLicenseApprovalPacket({ outputPath, actor });
  console.log(stableStringify({
    output_path: result.output_path,
    applied: true,
    packet_digest: result.packet.packet_digest
  }));
} else {
  const packet = buildPilotSourceLicenseApprovalPacket({ actor, mode: "dry-run" });
  console.log(stableStringify(packet));
}
