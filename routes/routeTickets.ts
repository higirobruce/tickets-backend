// const QRCode = require('qrcode');

import QRCode from "qrcode";

import { Router } from "express";
import { ticketModel } from "../models/tickets";
import createTicket, {
  getAllTickets,
  getTicketById,
} from "../controllers/controllerTickets";
import { Statuses } from "../models/events";
export function createQrCode(param: any) {
  QRCode.toDataURL(param, function (err, url) {
    return url;
  });
}

export async function generateTicketNumber() {
  // Get the last saved document
  const lastDocument = await ticketModel.findOne().sort({ number: -1 });
  // Generate a new 10-digit number, starting from 1000000000 and incrementing by 1
  let newNumber = 1000000000;
  if (lastDocument && lastDocument.number) {
    newNumber = lastDocument.number + 1;
  }

  // Return the new number
  return newNumber;
}

export async function generateTicketNumbers(quantity: number) {
  // Get the last saved document
  let totalNumber = 10000000 + (await ticketModel.find().count());
  let numbers: any[] = [];
  for (let i = 0; i < quantity; i++) {
    totalNumber++;
    numbers.push(totalNumber);
  }

  return numbers;
}

let router = Router();

router.get("/", async (req, res) => {
  let tickets = await getAllTickets();
  res.send(tickets);
});

router.get("/:id", async (req, res) => {
  let { id } = req.params;
  let ticket = await getTicketById(id);
  console.log(ticket);
  res.send(ticket);
});

router.get("/validate/:number", async (req, res) => {
  let number = req.params.number;

  let ticket = await ticketModel.findOneAndUpdate(
    { number, status: Statuses.sold },
    { $set: { status: Statuses.consumed } },
    { new: true }
  );

  if (ticket) res.send(ticket);
  else
    res
      .status(404)
      .send({ erroMessage: "Ticket not found or already consumed" });

  // res.send("Tickets can not be consumed now.");
});

router.get("/confirm/:number", async (req, res) => {
  let number = req.params.number;

  // let ticket = await ticketModel.findOneAndUpdate(
  //   { number, status: Statuses.sold },
  //   { $set: { status: Statuses.consumed } },
  //   { new: true }
  // );

  let ticket = await ticketModel.findOne({ number, status: Statuses.sold });
  
  if (ticket) res.redirect(`https//eventixr.com/tickets/${ticket?._id}`);

  else
    res
      .status(404)
      .send({ erroMessage: "Ticket not found or already consumed" });

  // res.send("Tickets can not be consumed now.");
});

router.get("/sell/:number", async (req, res) => {
  let number = parseInt(req.params.number);
  let ticket = await ticketModel.findOneAndUpdate(
    { number, status: Statuses.pending },
    { $set: { status: Statuses.sold } },
    { new: true }
  );
  if (ticket) res.send(ticket);
  else
    res.status(404).send({ erroMessage: "Ticket not found or already sold" });
});

router.post("/", async (req, res) => {
  try {
    let number = await generateTicketNumber();
    let { ticketPackage } = req.body;

    let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;

    let qrCode = "";
    QRCode.toDataURL(qrParam, async function (err, url) {
      qrCode = url;
      console.log(qrCode);

      let ticket = await createTicket({
        number,
        qrCode,
        ticketPackage,
      });

      res.status(201).send(ticket);
    });
  } catch (err) {
    res.status(500).send({ errorMessage: `${err}` });
  }
});

router.post("/batch/:quantity", async (req, res) => {
  let { quantity } = req.params;
  let tickets: any[] = [];
  try {
    let numbers = await generateTicketNumbers(parseInt(quantity));

    numbers.forEach((n) => {
      let { ticketPackage } = req.body;

      // let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;
      let qrParam = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/${n}`;

      let qrCode = "";
      QRCode.toDataURL(qrParam, function (err, url) {
        qrCode = url;

        let ticket = createTicket({
          number: n,
          qrCode,
          ticketPackage,
        });
        tickets.push(ticket);
      });
    });

    let allPromises = Promise.all(tickets);

    allPromises
      .then((v) => {
        res.status(201).send(v);
      })
      .catch((err) => {
        res.status(500).send({ errorMessage: `${err}` });
      });
  } catch (err) {
    res.status(500).send({ errorMessage: `${err}` });
  }
});

export default router;

// QRCode.toFile(
//   "/output-file-path/file.png",
//   "Encode this text in QR code",
//   {
//     errorCorrectionLevel: "H",
//   },
//   function (err: any) {
//     if (err) throw err;
//     console.log("QR code saved!");
//   }
// );
