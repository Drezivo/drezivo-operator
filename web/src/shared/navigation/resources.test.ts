import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATOR_VIEWS, enabledResourceIds, visibleResources, resources, resourceForPath, clientHref, businessHref } from "@/shared/navigation/resources";

describe("enabled operator views", () => {
  it("uses unique path URLs and resolves nested business records to their owning feature", () => {
    expect(new Set(resources.map((view) => view.path)).size).toBe(resources.length);
    expect(resources.every((view) => !view.path.includes("?"))).toBe(true);
    expect(resourceForPath("/clients/tenant-a")?.id).toBe("clients");
    expect(resourceForPath("/businesses/tenant-a")?.id).toBe("businesses");
    expect(resourceForPath("/assigned-plans")?.id).toBe("entitlements");
    expect(resourceForPath("/clients-unrelated")).toBeUndefined();
    expect(clientHref("id / a")).toBe("/clients/id%20%2F%20a");
    expect(businessHref("id / a")).toBe("/businesses/id%20%2F%20a");
  });
  it("enables the complete implemented console by default", () => {
    expect(enabledResourceIds(undefined)).toEqual([...DEFAULT_OPERATOR_VIEWS]);
    expect(visibleResources("").map((view) => view.id)).toEqual([...DEFAULT_OPERATOR_VIEWS]);
  });

  it("enables configured views in navigation order and ignores unknown or duplicate ids", () => {
    expect(visibleResources("operators, clients,clients,not-a-view").map((view) => view.id)).toEqual(["clients", "operators"]);
    expect(enabledResourceIds("not-a-view")).toEqual([...DEFAULT_OPERATOR_VIEWS]);
  });
});
