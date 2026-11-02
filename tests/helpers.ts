import request from "supertest";
import app from "../app";
import { eventModel } from "../models/events";

export const api = () => request(app);

export async function registerAndLogin(
  email = "gate@example.com",
  password = "pw-123456"
) {
  await api().post("/users").send({
    firstName: "Gate",
    lastName: "Staff",
    email,
    password,
    phoneNumber: { countryCode: "250", phone: "788000000" },
  });
  const res = await api().post("/users/login").send({ username: email, password });
  return { token: res.body.token as string, user: res.body.user };
}

export async function seedEvent(overrides: any = {}) {
  return eventModel.create({
    imageUrl: "https://images.unsplash.com/x",
    title: "Kigali Jazz Junction",
    date: new Date("2030-01-01T18:00:00Z"),
    artist: "Someone",
    location: "Kigali",
    packages: [
      { title: "Regular", price: 5000, currency: "RWF" },
      { title: "VIP", price: 20000, currency: "RWF" },
    ],
    ...overrides,
  });
}

export async function registerOrganiser(email = "owner@example.com", organisation = "Kigali Live") {
  const res = await api().post("/users/register").send({
    firstName: "Olive",
    lastName: "Owner",
    email,
    password: "pw-123456",
    organisation,
    phoneNumber: { countryCode: "250", phone: "788111222" },
  });
  return { status: res.status, token: res.body.token as string, user: res.body.user, body: res.body };
}

export const eventBody = (overrides: any = {}) => ({
  imageUrl: "https://images.unsplash.com/photo-1",
  title: "Iwacu Muzika Festival",
  date: "2030-12-05T16:00:00.000Z",
  artist: "Various",
  location: "Kigali Arena",
  packages: [
    { title: "Regular", price: 5000, currency: "RWF" },
    { title: "VIP", price: 20000, currency: "RWF" },
  ],
  ...overrides,
});
