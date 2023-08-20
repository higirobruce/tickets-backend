import { Router } from "express";
import { ensureUserAuthorized } from "..";
import {
  createTicket,
  getAllEvents,
  getEventById,
} from "../controllers/controllerEvents";
import {
  getAllUsers,
  getUser,
  getUserById,
  saveUser,
} from "../controllers/controllerUsers";
import { hashPassword } from "../services/users";

let router = Router();

router.get("/", async (req, res) => {
  res.send(await getAllUsers());
});

router.post("/login", async (req, res) => {
  let { username, password } = req.body;
  res.send(await getUser(username, password));
});

router.get("/:id", async (req, res) => {
  let { id } = req.params;
  res.send(await getUserById(id));
});

router.post("/", async (req, res) => {
  console.log('helllooooo')
  let { lastName, firstName, email, password, phoneNumber } = req.body;
  let hashedPassword = hashPassword(password);

  res.send(
    await saveUser({
      lastName,
      firstName,
      email,
      hashedPassword,
      phoneNumber,
    })
  );
});

export default router;
