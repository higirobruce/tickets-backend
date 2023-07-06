import { eventModel } from "../models/events";


export async function getAllEvents() {
  try {
    let events = await eventModel.find({});
    return events;
  } catch (err) {
    throw Error(`${err}`);
  }
}

export async function getEventById(id: string) {
  try {
    let event = await eventModel.findById(id);
    return event;
  } catch (err) {
    throw Error(`${err}`);
  }
}

export async function createTicket(eventDoc: any) {
  try {
    let newEvent = new eventModel(eventDoc);

    let event = await newEvent.save();
    return event;
  } catch (err) {
    throw Error(`${err}`);
  }
}
