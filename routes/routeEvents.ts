import { Router } from "express";
import { ensureUserAuthorized } from "..";
import { createTicket, getAllEvents, getEventById } from "../controllers/controllerEvents";

let router = Router();

router.get("/", async (req, res) => {
  res.send(await getAllEvents());
});

router.get("/:id", async (req, res) => {
  res.send(await getEventById(req?.params?.id));
});

router.post("/", async (req, res) => {
  console.log("Bodyyyyy", req.body);
  res.send(await createTicket(req.body));
});

export default router;
