import type { Capability, CapabilityKey } from "../../../shared/contracts";

const REMOTE_ONLY_AFDFW_CAPABILITIES = new Set<CapabilityKey>([
  "afdfw-music-generation",
  "afdfw-image-generation",
  "afdfw-session",
]);

export function isCapabilityOffByDesign(capability: Capability) {
  return capability.state === "unavailable"
    && capability.provider === "remote mode only"
    && REMOTE_ONLY_AFDFW_CAPABILITIES.has(capability.key);
}

export function capabilitiesNeedingAttention(capabilities: Capability[]) {
  return capabilities.filter((capability) => capability.state !== "available" && !isCapabilityOffByDesign(capability));
}
