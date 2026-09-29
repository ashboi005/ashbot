import { describe, expect, test } from "bun:test";

import { findProject, parseProfiles, secretsOf } from "./profile";

const file = {
  projects: [
    {
      id: "acme",
      name: "Acme Portal",
      coolify: { baseUrl: "https://coolify.acme.example", token: "cool-token-1", apps: [{ name: "api", uuid: "u1" }] },
      axiom: { token: "xaat-axiom-token", datasets: ["acme-api"] },
      aws: { region: "ap-south-1", accessKeyId: "AKIAEXAMPLEKEY000000", secretAccessKey: "aws-secret-value" },
    },
    { id: "beta", name: "Beta" },
  ],
};

describe("parseProfiles", () => {
  test("parses and applies defaults", () => {
    const [acme, beta] = parseProfiles(file);
    expect(acme?.runbook).toBe("");
    expect(acme?.axiom?.baseUrl).toBe("https://api.axiom.co");
    expect(acme?.aws?.logGroups).toEqual([]);
    expect(acme?.aws?.buckets).toEqual([]);
    expect(beta?.coolify).toBeUndefined();
  });

  test("rejects duplicate project ids", () => {
    expect(() => parseProfiles({ projects: [file.projects[1], file.projects[1]] })).toThrow("Duplicate project id");
  });

  test("rejects invalid app names with a readable error", () => {
    const bad = { projects: [{ id: "x", name: "X", coolify: { baseUrl: "https://c.example", token: "t", apps: [{ name: "Bad Name", uuid: "u" }] } }] };
    expect(() => parseProfiles(bad)).toThrow("Invalid projects file");
  });
});

describe("findProject", () => {
  test("finds by id", () => {
    expect(findProject(parseProfiles(file), "beta").name).toBe("Beta");
  });

  test("lists known ids when not found", () => {
    expect(() => findProject(parseProfiles(file), "nope")).toThrow('Unknown project "nope". Known: acme, beta');
  });
});

describe("secretsOf", () => {
  test("returns every credential for redaction", () => {
    const [acme] = parseProfiles(file);
    expect(secretsOf(acme!).sort()).toEqual(["AKIAEXAMPLEKEY000000", "aws-secret-value", "cool-token-1", "xaat-axiom-token"]);
  });
});
