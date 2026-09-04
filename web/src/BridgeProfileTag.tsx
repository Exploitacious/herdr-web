import type { DiscoveredBridgeProfile } from "./discoveredBridges";

// Small inline tag that marks which Claude profile a discovered bridge runs
// under (work vs personal), shown after the bridge name. Discovery is the only
// source of this data; the herdr API cannot supply it. An "other" profile and
// an absent profile render nothing, so the tag only ever adds signal.
//
// `compact` renders a single-letter W/P for the narrow host chips (the full
// word squeezes the session name to one glyph at a 320-400px sidebar); the
// full word stays for space-group headers and the Settings summary. The
// accessible name is always the whole word.
export function BridgeProfileTag({
  profile,
  compact = false,
}: {
  profile?: DiscoveredBridgeProfile;
  compact?: boolean;
}) {
  if (profile !== "work" && profile !== "personal") {
    return null;
  }
  if (compact) {
    return (
      <span
        className="bridge-profile-tag bridge-profile-tag-compact"
        data-profile={profile}
        title={profile}
        aria-label={profile}
      >
        {profile === "work" ? "W" : "P"}
      </span>
    );
  }
  return (
    <span className="bridge-profile-tag" data-profile={profile}>
      {profile}
    </span>
  );
}
