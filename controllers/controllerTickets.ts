import { ticketModel } from "../models/tickets";


export async function getAllTickets() {
  try {
    let tickets = await ticketModel.find({"ticketPackage.title":"Invitation"});
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

export async function getTicketByNumber(id: String) {
  try {
    let ticket = await ticketModel.findOne({number:id})
    return ticket;
  } catch (err) {
    console.log(err);
    throw Error(`${err}`);
  }
}

export async function updateTicket(id: String, updates: any) {
  try {
    let ticket = await ticketModel.findByIdAndUpdate(id, {$set: updates})
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



