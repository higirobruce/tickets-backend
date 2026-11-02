import { ticketModel } from "../models/tickets";

export async function getAllTickets(scope: any = {}) {
  return ticketModel.find(scope).sort({ createdAt: -1 });
}

export async function getTicketById(id: string) {
  return ticketModel.findById(id);
}

export async function getTicketByNumber(number: number) {
  return ticketModel.findOne({ number });
}

export async function updateTicket(id: string, updates: any) {
  return ticketModel.findByIdAndUpdate(id, { $set: updates }, { new: true });
}

export default async function createTicket(ticketDoc: any) {
  const newTicket = new ticketModel(ticketDoc);
  return newTicket.save();
}
