import { ticketModel } from "../models/tickets";


export async function getAllTickets() {
  try {
    let tickets = await ticketModel.find({});
    return tickets;
  } catch (err) {
    console.log(err);
    throw Error(`${err}`);
  }
}

export async function getTicketById(id: String) {
  try {
    let ticket = await ticketModel.findById(id)
    return ticket;
  } catch (err) {
    console.log(err);
    throw Error(`${err}`);
  }
}

export default async function createTicket(ticketDoc: any) {
  try {
    let newTicket = new ticketModel(ticketDoc);
    let ticket = await newTicket.save();
    return ticket;
  } catch (err) {
    console.log(err);
    throw Error(`${err}`);
  }
}
