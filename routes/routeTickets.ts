// const QRCode = require('qrcode');

import QRCode from "qrcode";

import { Router } from "express";
import { packageSchema, ticketModel } from "../models/tickets";
import createTicket, {
  getAllTickets,
  getTicketById,
} from "../controllers/controllerTickets";
import { Statuses } from "../models/events";
import { validate } from "node-cron";
import sendMessage from "./routeSMS";
import mongoose from "mongoose";
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

router.get("/show/:number", async (req, res, next) => {
  let number = req.params.number;

  // let ticket = await ticketModel.findOneAndUpdate(
  //   { number, status: Statuses.sold },
  //   { $set: { status: Statuses.consumed } },
  //   { new: true }
  // );

  let ticket = await ticketModel.findOne({
    number,
    // status: { $in: [Statuses.pending, Statuses.sold] },
  });

  if (ticket)
    res.redirect(
      301,
      `https://www.eventixr.com/tickets/${ticket?._id}?showOnly=1`
    );
  else
    res
      .status(404)
      .send({ erroMessage: "Ticket not found or already consumed" });

  // res.send("Tickets can not be consumed now.");
});

router.get("/validate/:number", async (req, res, next) => {
  let number = req.params.number;
  let { showOnly } = req.query;

  // let ticket = await ticketModel.findOneAndUpdate(
  //   { number, status: Statuses.sold },
  //   { $set: { status: Statuses.consumed } },
  //   { new: true }
  // );

  let ticket = await ticketModel.findOne({
    number,
    // status: { $in: [Statuses.pending, Statuses.sold] },
  });

  if (ticket) {
    if (!showOnly)
      res.redirect(301, `https://www.eventixr.com/tickets/${ticket?._id}`);
    else
      res.redirect(
        301,
        `https://www.eventixr.com/tickets/${ticket?._id}?showOnly=${showOnly}`
      );
  } else
    res
      .status(404)
      .send({ erroMessage: "Ticket not found or already consumed" });

  // res.send("Tickets can not be consumed now.");
});

router.get("/sell/:number", async (req, res) => {
  let number = parseInt(req.params.number);
  let { momoRef } = req.query;

  let ticket = await ticketModel.findOneAndUpdate(
    { number, status: Statuses.pending },
    { $set: { status: Statuses.sold, momoRef } },
    { new: true }
  );

  if (ticket) res.send(ticket);
  else {
    res.statusMessage = "Ticket not found or already sold";
    res.status(404).send({ erroMessage: "Ticket not found or already sold" });
  }
});

router.get("/consume/:number", async (req, res) => {
  let number = parseInt(req.params.number);

  let ticket = await ticketModel.findOneAndUpdate(
    { number, status: Statuses.pending },
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

router.get("/summary", async (req, res) => {
  try {
    let summary = await getTicketsSummary();

    res.send(summary);
  } catch (err) {
    res.status(500).send({ error: `${err}` });
  }
});

router.get("/:id", async (req, res) => {
  let { id } = req.params;
  let ticket = await getTicketById(id);
  res.send(ticket);
});

router.post("/", async (req, res) => {
  try {
    let number = await generateTicketNumber();
    let { ticketPackage } = req.body;

    let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;

    let qrCode = "";
    QRCode.toDataURL(qrParam, async function (err, url) {
      qrCode = url;

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
  res.status(201).send(await createTickets(quantity, req, tickets, res, null));
});

router.post("/fromPayload", async (req, res) => {
  let { ticketPackage, momoPayload, quantity } = req.body;

  res.send(
    await createTicketsFromPayload(quantity, ticketPackage, [], "", momoPayload)
  );
});

export default router;

export async function createTickets(
  quantity: string,
  req: any,
  tickets: any[],
  res: any,
  momoPayload: any
) {
  try {
    let numbers = await generateTicketNumbers(parseInt(quantity));

    numbers.forEach((n) => {
      let { ticketPackage } = req.body;

      // let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;
      let qrParam = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/${n}`;
      let qrParamShowOnly = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/${n}?showOnly=1`;

      let qrCode = "";
      QRCode.toDataURL(qrParam, function (err, url) {
        qrCode = url;

        let ticket = createTicket({
          number: n,
          qrCode,
          ticketPackage,
          momoPayload,
        });

        sendMessage(
          `+${momoPayload?.payer?.partyId}`,
          `Ikaze mu gitaramo IBISINGIZO BYA NYIRIBIREMWA. Itike yanyu ${n} mwayibona aha ${qrParamShowOnly}. Mwaguze ${ticketPackage?.title} ticket - igura ${ticketPackage?.price} ${ticketPackage?.currency}`,
          "EVENTIXR"
        );
        tickets.push(ticket);
      });
    });

    let allPromises = Promise.all(tickets);

    return allPromises
      .then((v) => {
        return v;
        // res.status(201).send(v);
      })
      .catch((err) => {
        throw Error(`${err}`);
        // res.status(500).send({ errorMessage: `${err}` });
      });
  } catch (err) {
    throw Error(`${err}`);
    // res.status(500).send({ errorMessage: `${err}` });
  }
}

export async function createTicketsFromPayload(
  quantity: string,
  ticketPackage: any,
  tickets: any[],
  res: any,
  momoPayload: any
) {
  ticketPackage._id = new mongoose.Types.ObjectId(ticketPackage._id);
  console.log(ticketPackage);
  try {
    let numbers = await generateTicketNumbers(parseInt(quantity));

    numbers.forEach((n) => {
      // let qrParam = `${process.env.TICKETS_BCKEND_URL}:${process.env.BCKEND_PORT}/tickets/validate/${number}`;
      let qrParam = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/${n}`;
      let qrParamShowOnly = `${process.env.TICKETS_BCKEND_URL}/tickets/validate/${n}?showOnly=1`;

      let qrCode = "";
      QRCode.toDataURL(qrParam, function (err, url) {
        qrCode = url;

        let ticket = createTicket({
          number: n,
          qrCode,
          ticketPackage,
          momoPayload,
        });
        sendMessage(
          `+${momoPayload?.payer?.partyId}`,
          `Ikaze mu gitaramo IBISINGIZO BYA NYIRIBIREMWA. Itike yanyu ${n} mwayibona aha ${qrParamShowOnly}. Mwaguze ${ticketPackage?.title} ticket - igura ${ticketPackage?.price} ${ticketPackage?.currency}`,
          "EVENTIXR"
        );
        tickets.push(ticket);
      });
    });

    let allPromises = Promise.all(tickets);

    return allPromises
      .then((v) => {
        return v;
        // res.status(201).send(v);
      })
      .catch((err) => {
        throw Error(`${err}`);
        // res.status(500).send({ errorMessage: `${err}` });
      });
  } catch (err) {
    throw Error(`${err}`);
    // res.status(500).send({ errorMessage: `${err}` });
  }
}

export async function getTicketsSummary() {
  let pipeline = [
    {
      $match: {
        createdAt: {
          $gte: new Date("Fri, 13 Aug 2023 00:00:00 GMT"),
        },
      },
    },
    {
      $group: {
        _id: "$ticketPackage.title",
        count: {
          $count: {},
        },
        total: {
          $sum: {
            $toInt: "$momoPayload.amount",
          },
        },
      },
    },
  ];

  let data = await ticketModel.aggregate(pipeline).sort({ _id: -1 });

  return data;
}
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
