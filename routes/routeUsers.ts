import mongoose from "mongoose";
import { Router } from "express";
import { ensureUserAuthorized } from "..";
import { getAllUsers } from "../controllers/controllerUsers";
let router = Router();

router.get("/", async (req, res) => {
  res.send(await getAllUsers());
});

export default router;
