import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATOR_VIEWS, enabledResourceIds, visibleResources } from "./resources";

describe("enabled operator views", () => {
  it("enables the complete implemented console by default", () => {
    expect(enabledResourceIds(undefined)).toEqual([...DEFAULT_OPERATOR_VIEWS]);
    expect(visibleResources("").map((view) => view.id)).toEqual([...DEFAULT_OPERATOR_VIEWS]);
  });

  it("enables configured views in navigation order and ignores unknown or duplicate ids", () => {
    expect(visibleResources("operators, clients,clients,not-a-view").map((view) => view.id)).toEqual(["clients", "operators"]);
    expect(enabledResourceIds("not-a-view")).toEqual([...DEFAULT_OPERATOR_VIEWS]);
  });
});
