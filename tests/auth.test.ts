import { describe, it, expect, vi } from "vitest";
import { api, registerAndLogin, seedEvent } from "./helpers";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

describe("authorisation", () => {
  it("login returns a token and a user without the password hash", async () => {
    const { token, user } = await registerAndLogin();
    expect(token).toBeTypeOf("string");
    expect(user.email).toBe("gate@example.com");
    expect(user.password).toBeUndefined();
  });

  it("login with a wrong password is a 401", async () => {
    await registerAndLogin();
    const res = await api()
      .post("/users/login")
      .send({ username: "gate@example.com", password: "nope" });
    expect(res.status).toBe(401);
  });

  it("registration is open only for the first user", async () => {
    const first = await api().post("/users").send({
      firstName: "A", email: "a@x.com", password: "pw-123456",
    });
    expect(first.status).toBe(201);
    const second = await api().post("/users").send({
      firstName: "B", email: "b@x.com", password: "pw-123456",
    });
    expect(second.status).toBe(401);
  });

  it("protected routes reject anonymous callers", async () => {
    const checks = [
      api().get("/users"),
      api().get("/tickets"),
      api().get("/tickets/summary"),
      api().get("/tickets/consume/10000001"),
      api().post("/events").send({}),
      api().post("/tickets/batch/2").send({}),
      api().post("/momo/sendSMS").send({}),
    ];
    for (const c of await Promise.all(checks)) expect(c.status).toBe(401);
  });

  it("public routes stay open", async () => {
    const event = await seedEvent();
    expect((await api().get("/events")).status).toBe(200);
    expect((await api().get(`/events/${event._id}`)).status).toBe(200);
    expect((await api().get("/")).status).toBe(200);
  });

  it("user listing never returns password hashes", async () => {
    const { token } = await registerAndLogin();
    const res = await api().get("/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].password).toBeUndefined();
  });
});
