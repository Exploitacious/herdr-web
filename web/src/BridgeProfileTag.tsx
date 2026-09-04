import type { DiscoveredBridgeProfile } from "./discoveredBridges";

// Small inline tag that marks which Claude profile a discovered bridge runs
// under (work vs personal), shown after the bridge name. Discovery is the only
// source of this data; the herdr API cannot supply it. An "other" profile and
// an absent profile render nothing, so the tag only ever adds signal.
export function BridgeProfileTag({ profile }: { profile?: DiscoveredBridgeProfile }) {
  if (profile !== "work" && profile !== "personal") {
    return null;
  }
  return (
    <span className="bridge-profile-tag" data-profile={profile}>
      {profile}
    </span>
  );
}
