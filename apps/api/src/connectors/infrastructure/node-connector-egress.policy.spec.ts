import { NodeConnectorEgressPolicy } from "./node-connector-egress.policy";

describe("NodeConnectorEgressPolicy", () => {
  it("fails closed for private and mixed DNS answers", async () => {
    const resolver = () =>
      Promise.resolve([{ address: "93.184.216.34" }, { address: "127.0.0.1" }]);
    const policy = new NodeConnectorEgressPolicy(["vendor.example"], resolver);
    await expect(
      policy.validate({ baseUrl: "https://vendor.example" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("does not resolve unapproved or unsafe URLs", async () => {
    const resolver = jest
      .fn()
      .mockResolvedValue([{ address: "93.184.216.34" }]);
    const policy = new NodeConnectorEgressPolicy(["vendor.example"], resolver);
    for (const baseUrl of [
      "http://vendor.example",
      "https://user:password@vendor.example",
      "https://127.0.0.1",
      "https://vendor.example:444",
      "https://other.example",
      "https://vendor.example?token=value",
    ]) {
      await expect(policy.validate({ baseUrl })).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    expect(resolver).not.toHaveBeenCalled();
  });
  it("rechecks DNS on every validation instead of caching a public answer", async () => {
    const resolver = jest
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34" }])
      .mockResolvedValueOnce([{ address: "10.0.0.1" }]);
    const policy = new NodeConnectorEgressPolicy(["vendor.example"], resolver);
    await policy.validate({ baseUrl: "https://vendor.example" });
    await expect(
      policy.validate({ baseUrl: "https://vendor.example" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});

it("accepts fixture-only configuration without DNS and validates hostname normalization", async () => {
  const resolver = jest.fn().mockResolvedValue([{ address: "93.184.216.34" }]);
  const policy = new NodeConnectorEgressPolicy(
    [" VENDOR.EXAMPLE ", ""],
    resolver,
  );
  await policy.validate({});
  expect(resolver).not.toHaveBeenCalled();
  await policy.validate({ baseUrl: "https://vendor.example" });
  expect(resolver).toHaveBeenCalledWith("vendor.example");
});
it("fails closed on unsupported configuration keys", async () => {
  await expect(
    new NodeConnectorEgressPolicy([]).validate({ secret: "forbidden" }),
  ).rejects.toMatchObject({ code: "invalid_request" });
});

it("requires explicit approved self-managed GitLab hosts and public DNS on every read", async () => {
  const resolver = jest.fn().mockResolvedValue([{ address: "93.184.216.34" }]);
  const config = { providerHost: "gitlab.example.com", projectId: "123" };
  await expect(
    new NodeConnectorEgressPolicy([], resolver).validate(config, "gitlab_ci"),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(resolver).not.toHaveBeenCalled();
  const policy = new NodeConnectorEgressPolicy(
    ["gitlab.example.com"],
    resolver,
  );
  await policy.validate(config, "gitlab_ci");
  expect(resolver).toHaveBeenCalledWith("gitlab.example.com");
  resolver.mockResolvedValue([{ address: "10.0.0.1" }]);
  await expect(policy.validate(config, "gitlab_ci")).rejects.toMatchObject({
    code: "invalid_request",
  });
});

it("allows only the Jira Cloud API host for Jira metadata", async () => {
  const resolver = jest.fn().mockResolvedValue([{ address: "93.184.216.34" }]);
  const policy = new NodeConnectorEgressPolicy([], resolver);
  await policy.validate(
    {
      providerHost: "api.atlassian.com",
      siteHost: "tenant.atlassian.net",
      cloudId: "00000000-0000-4000-8000-000000000004",
    },
    "jira",
  );
  expect(resolver).toHaveBeenCalledWith("api.atlassian.com");
  await expect(
    policy.validate(
      {
        providerHost: "tenant.atlassian.net",
        siteHost: "tenant.atlassian.net",
        cloudId: "00000000-0000-4000-8000-000000000004",
      },
      "jira",
    ),
  ).rejects.toMatchObject({ code: "invalid_request" });
});
