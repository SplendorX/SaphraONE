/**
 * The admin platform's access rules: owners open everything, members only
 * what they were given, and Team & access / Audit log are owners' alone.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/__tests__/admin-tools.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  actorCan,
  adminToolForPath,
  adminTools,
  assignableTools,
  isAdminToolId,
} from "@/lib/admin/tools";

const owner = { id: "owner-key", label: "Owner key", role: "owner", tools: [], via: "key" };
const support = { id: "0xabc", label: "sam.one", role: "member", tools: ["support"], via: "account" };

describe("admin access", () => {
  it("lets an owner open every tool", () => {
    for (const tool of adminTools) assert.equal(actorCan(owner, tool.id), true);
  });

  it("lets a member open only the tools they were given", () => {
    assert.equal(actorCan(support, "support"), true);
    assert.equal(actorCan(support, "users"), false);
    assert.equal(actorCan(support, "team"), false);
  });

  it("never offers the owner-only tools to members", () => {
    const ids = assignableTools.map((tool) => tool.id);
    assert.equal(ids.includes("team"), false);
    assert.equal(ids.includes("audit"), false);
    assert.equal(ids.includes("users"), true);
  });

  it("knows which tool a page belongs to", () => {
    assert.equal(adminToolForPath("/admin"), null);
    assert.equal(adminToolForPath("/admin/users"), "users");
    assert.equal(adminToolForPath("/admin/business-verifications"), "verifications");
    assert.equal(adminToolForPath("/admin/kyc"), "verifications");
    assert.equal(adminToolForPath("/admin/team/anything"), "team");
  });

  it("accepts only real tool ids", () => {
    assert.equal(isAdminToolId("support"), true);
    assert.equal(isAdminToolId("everything"), false);
    assert.equal(isAdminToolId(undefined), false);
  });
});
