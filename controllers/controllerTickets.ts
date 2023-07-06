import { ticketModle } from "../models/tickets";


export async function getAllTickets() {
  try {
    let tickets = await ticketModle.find({});
    return tickets;
  } catch (err) {
    console.log(err);
    throw Error(`${err}`);
  }
}

export default async function createTicket(ticketDoc: any) {
  try {
    let newTicket = new ticketModle(ticketDoc);
    let ticket = await newTicket.save();
    return ticket;
  } catch (err) {
    console.log(err);
    throw Error(`${err}`);
  }
}
