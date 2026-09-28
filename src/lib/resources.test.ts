import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATOR_VIEWS, enabledResourceIds, visibleResources } from "./resources";

describe("enabled operator views", () => {
  it("shows only the live views by default, with Clients first", () => {
    expect(enabledResourceIds(undefined)).toEqual([...DEFAULT_OPERATOR_VIEWS]);
    expect(visibleResources("").map((view) => view.id)).toEqual(["clients"]);
  });

  it("enables configured views in navigation order and ignores unknown or duplicate ids", () => {
    expect(visibleResources("operators, clients,clients,not-a-view").map((view) => view.id)).toEqual(["clients", "operators"]);
    expect(enabledResourceIds("not-a-view")).toEqual([...DEFAULT_OPERATOR_VIEWS]);
  });
});
