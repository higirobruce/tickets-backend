import mongoose from "mongoose";

export enum Currencies {
  rwf = "RWF",
  usd = "USD",
  eur = "EUR",
}

export enum Statuses {
  pending='pending',
  ongoing='ongoing',
  expired='expired',
  cancelled='cancelled',
  posponed='postponed',
  upcoming='upcoming',
  consumed='consumed'
}

export const packageSchema = new mongoose.Schema({
  title: {
    type: String,
  },
  currency: {
    type: String,
    default: Currencies.rwf,
  },
  price:{
    type: Number
  }
});

export const eventSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  artist: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  packages: [{ type: packageSchema }],
  status: {
    type: String,
    default: Statuses.pending,
  },
});

export const eventModel = mongoose.model("events", eventSchema);
// {
//     _id: "1",
//     imageUrl:
//       "https://rgtickets.com/wp-content/uploads/2022/08/WhatsApp-Image-2022-08-25-at-2.05.58-PM-1.jpeg",
//     title: "Igicaniro Concert Series with Luc Buntu",
//     date: "01st June 2021",
//     time: "18h",
//     artist: "Luc Buntu",
//     location: "The Prayer House",
//     packages: [
//       {
//         title: "Regular",
//         price: 5000,
//         currency: "RWF",
//       },
//       {
//         title: "VIP",
//         price: 10000,
//         currency: "RWF",
//       },
//       {
//         title: "VVIP",
//         price: 30000,
//         currency: "RWF",
//       },
//     ],
//     status: 'pending'
//   },
