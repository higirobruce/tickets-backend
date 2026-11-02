import { describe, it, expect, vi, beforeEach } from "vitest";
import sendMessage from "../services/sms";
import { fetchMock } from "./setup";
import { api, seedEvent } from "./helpers";
import { ticketModel } from "../models/tickets";
import { paymentModel, PaymentStatuses } from "../models/payments";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

const smsMock = sendMessage as unknown as ReturnType<typeof vi.fn>;

function momoResponse(body: any, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Error",
    json: async () => body,
  };
}

beforeEach(() => {
  smsMock.mockReset();
});

async function startPayment(event: any) {
  fetchMock
    .mockResolvedValueOnce(momoResponse({ access_token: "tok" })) // token
    .mockResolvedValueOnce(momoResponse({}, 202)); // requesttopay
  const res = await api()
    .post("/momo/requestToPay")
    .send({
      amount: "5000",
      currency: "RWF",
      payer: { partyIdType: "MSISDN", partyId: "250788123456" },
      payerMessage: "Buying",
      payeeNote: "Note",
      eventId: String(event._id),
      ticketPackage: { title: "Regular", price: 5000, currency: "RWF" },
    });
  return res;
}

function mockSuccessfulStatus() {
  fetchMock
    .mockResolvedValueOnce(momoResponse({ access_token: "tok" }))
    .mockResolvedValueOnce(
      momoResponse({
        status: "SUCCESSFUL",
        amount: "5000",
        currency: "RWF",
        payer: { partyIdType: "MSISDN", partyId: "250788123456" },
        financialTransactionId: "123",
      })
    );
}

describe("MoMo payment flow", () => {
  it("requestToPay returns a refId and records the payment", async () => {
    const event = await seedEvent();
    const res = await startPayment(event);
    expect(res.status).toBe(202);
    expect(res.body.refId).toBeTypeOf("string");
  });

  it("a successful status issues exactly one ticket even when polled twice", async () => {
    const event = await seedEvent();
    const { refId } = (await startPayment(event)).body;

    mockSuccessfulStatus();
    const first = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("SUCCESSFUL");
    expect(first.body.tickets).toHaveLength(1);

    mockSuccessfulStatus();
    const second = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(second.body.status).toBe("SUCCESSFUL");
    expect(second.body.tickets).toHaveLength(1);

    expect(await ticketModel.countDocuments()).toBe(1);
    expect(smsMock).toHaveBeenCalledTimes(1);
  });

  it("the issued ticket is linked to the event and the payment reference", async () => {
    const event = await seedEvent();
    const { refId } = (await startPayment(event)).body;
    mockSuccessfulStatus();
    await api().get(`/momo/statusOfRequest/${refId}`);

    const ticket = await ticketModel.findOne();
    expect(String(ticket!.event)).toBe(String(event._id));
    expect(ticket!.momoRef).toBe(refId);
    expect(ticket!.ticketPackage!.title).toBe("Regular");
    expect(ticket!.momoPayload.status).toBe("SUCCESSFUL");
  });

  it("the SMS names the event, not a hardcoded concert", async () => {
    const event = await seedEvent({ title: "Rubavu Beach Party" });
    const { refId } = (await startPayment(event)).body;
    mockSuccessfulStatus();
    await api().get(`/momo/statusOfRequest/${refId}`);

    const [to, message] = smsMock.mock.calls[0];
    expect(to).toBe("+250788123456");
    expect(message).toContain("Rubavu Beach Party");
    expect(message).not.toContain("NZAKINGURA");
    expect(message).toContain("http://api.test/tickets/validate/");
  });

  it("a pending status issues nothing", async () => {
    const event = await seedEvent();
    const { refId } = (await startPayment(event)).body;
    fetchMock
      .mockResolvedValueOnce(momoResponse({ access_token: "tok" }))
      .mockResolvedValueOnce(momoResponse({ status: "PENDING" }));
    const res = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(res.body.status).toBe("PENDING");
    expect(await ticketModel.countDocuments()).toBe(0);
  });

  it("a MoMo error on the status check responds once with the upstream status", async () => {
    const event = await seedEvent();
    const { refId } = (await startPayment(event)).body;
    fetchMock
      .mockResolvedValueOnce(momoResponse({ access_token: "tok" }))
      .mockResolvedValueOnce(momoResponse({}, 500));
    const res = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(res.status).toBe(502);
  });

  it("a failed requesttopay with an empty statusText responds 502 with a fallback message and marks the payment FAILED", async () => {
    const event = await seedEvent();
    fetchMock
      .mockResolvedValueOnce(momoResponse({ access_token: "tok" }))
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "", json: async () => ({}) });
    const res = await api().post("/momo/requestToPay").send({
      amount: "5000",
      currency: "RWF",
      payer: { partyIdType: "MSISDN", partyId: "250788123456" },
      eventId: String(event._id),
      ticketPackage: { title: "Regular", price: 5000, currency: "RWF" },
    });
    expect(res.status).toBe(502);
    expect(res.body.message).toBe("Payment request failed");
    const payment = await paymentModel.findOne({ refId: res.body.refId });
    expect(payment?.status).toBe(PaymentStatuses.failed);
  });
});

describe("legacy requestToPay input", () => {
  it("a non-numeric amount is a 400, not a 500", async () => {
    const res = await api().post("/momo/requestToPay").send({ amount: "abc", currency: "RWF", payer: { partyIdType: "MSISDN", partyId: "250788123456" } });
    expect(res.status).toBe(400); expect(res.body).toEqual({ errorMessage: "amount must be a number" });
    expect(await paymentModel.countDocuments()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
