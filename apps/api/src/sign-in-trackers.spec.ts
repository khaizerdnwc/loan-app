import {
  accountKey,
  signInAccountGlobalTracker,
  signInAccountTracker,
  sourceKey,
} from "./sign-in-trackers";

describe("sign-in throttle keys (H8)", () => {
  it.each([
    ["IPv4 as is", "198.51.100.7", "198.51.100.7"],
    ["IPv4-mapped IPv6 counts as the IPv4 address", "::ffff:198.51.100.7", "198.51.100.7"],
    ["IPv6 counts as its /64", "2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["another address in the same /64, the same key", "2001:db8:1:2::9", "2001:db8:1:2::/64"],
    ["no address", undefined, "unknown"],
  ] as const)("%s", (_label, ip, expected) => {
    expect(sourceKey(ip)).toBe(expected);
  });

  it("a different /64 is a different source", () => {
    expect(sourceKey("2001:db8:1:3::1")).not.toBe(sourceKey("2001:db8:1:2::1"));
  });

  it("names the account as the service looks it up", () => {
    expect(accountKey({ body: { username: "  Paolo " } })).toBe("paolo");
    expect(accountKey({ body: { username: 42 } })).toBe("");
    expect(accountKey({})).toBe("");
  });

  it("signInAccount keys on source and account; rotating inside a /64 does not change it", () => {
    const a = signInAccountTracker({ ip: "2001:db8:1:2::1", body: { username: "rina" } });
    const b = signInAccountTracker({ ip: "2001:db8:1:2::ffff", body: { username: "RINA" } });
    expect(a).toBe("2001:db8:1:2::/64|rina");
    expect(b).toBe(a);
  });

  it("signInAccountGlobal keys on the account alone, whatever the address", () => {
    const a = signInAccountGlobalTracker({ ip: "198.51.100.1", body: { username: "rina" } });
    const b = signInAccountGlobalTracker({ ip: "203.0.113.9", body: { username: "rina" } });
    expect(a).toBe("account|rina");
    expect(b).toBe(a);
  });
});
