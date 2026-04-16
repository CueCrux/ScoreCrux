import { describe, it, expect, beforeEach } from "vitest";
import { handleRequest, resetStore, type Request } from "../../solution.js";

const validHeaders = { authorization: "Bearer valid-token" };

function makeReq(
  overrides: Partial<Request> & { method: string }
): Request {
  return {
    headers: validHeaders,
    params: {},
    ...overrides,
  } as Request;
}

describe("Handler", () => {
  beforeEach(() => {
    resetStore();
  });

  it("GET returns all items", () => {
    handleRequest(makeReq({ method: "POST", body: { name: "Test" } }));
    const res = handleRequest(makeReq({ method: "GET" }));
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it("POST creates an item", () => {
    const res = handleRequest(
      makeReq({ method: "POST", body: { id: "i1", name: "Widget" } })
    );
    expect(res.status).toBe(201);
    const body = res.body as { success: boolean; data: { id: string } };
    expect(body.data.id).toBe("i1");
  });

  it("PUT updates an item", () => {
    handleRequest(
      makeReq({ method: "POST", body: { id: "i1", name: "Widget" } })
    );
    const res = handleRequest(
      makeReq({
        method: "PUT",
        params: { id: "i1" },
        body: { name: "Gadget" },
      })
    );
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: { name: string } };
    expect(body.data.name).toBe("Gadget");
  });

  it("DELETE removes an item", () => {
    handleRequest(
      makeReq({ method: "POST", body: { id: "i1", name: "Widget" } })
    );
    const res = handleRequest(
      makeReq({ method: "DELETE", params: { id: "i1" } })
    );
    expect(res.status).toBe(200);
    const getRes = handleRequest(
      makeReq({ method: "GET", params: { id: "i1" } })
    );
    expect(getRes.status).toBe(404);
  });

  it("rejects requests without auth", () => {
    const res = handleRequest({
      method: "GET",
      headers: {},
      params: {},
    });
    expect(res.status).toBe(401);
  });

  it("returns 405 for unsupported methods", () => {
    const res = handleRequest(makeReq({ method: "PATCH" }));
    expect(res.status).toBe(405);
  });
});
