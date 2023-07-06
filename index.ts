import express, { Express, NextFunction, Request, Response } from "express";
import bodyParser = require("body-parser");
import session = require("express-session");
import cors = require("cors");
import passport = require("passport");
import MongoStore = require("connect-mongo");
import mongoose from "mongoose";
import jwt, { JwtPayload } from "jsonwebtoken";

import usersRoute from "./routes/routeUsers";
import eventsRoute from "./routes/routeEvents";
import momoRoute from "./routes/routeMomo";
import ticketsRoute from "./routes/routeTickets";

declare module "express-session" {
  export interface SessionData {
    user: any;
    accessToken: any;
    momoToken: any;
  }
}
// dotenv.config();

const PORT =  8081;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
//Set up default mongoose connection
// var mongoDB = `mongodb://${DB_USER}:${DB_PASSWORD}@127.0.0.1:27017/dapproval-user-service?authSource=admin`;

var mongoDB =
  process.env.TICKETS_DB ||
  `mongodb+srv://mongo-admin:2tij6e0anAgKU6tb@myfreecluster.kxvgw.mongodb.net/tickets?retryWrites=true&w=majority`;

mongoose.connect(mongoDB);
//Get the default connection

var db = mongoose.connection;
//Bind connection to error event (to get notification of connection errors)
db.on("error", console.error.bind(console, "MongoDB connection error:"));
// db.on("error", console.error.bind(console, "MongoDB connection error:"));

db.once("open", () => console.log("connected to db"));

//Basic Authorization
let auth = (req: Request, res: Response, next: NextFunction) => {
  // const auth = { login: "eproc@2023", password: "rT%b23W3UHdRKavrJ!6Y" }; // change this
  const auth = {
    login: process.env.CONS_API_USER,
    password: process.env.CONS_API_PASS,
  }; // change this
  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = Buffer.from(b64auth, "base64")
    .toString()
    .split(":");
  if (login && password && login === auth.login && password === auth.password) {
    return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="401"'); // change this
  res.status(401).send("Authentication required."); // custom message
};

const app: Express = express();

app.use(cors());
// app.use(auth);
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "5mb" }));

app.use(cors());
// app.use(auth)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(
  session({
    secret: "keyboard cat",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: mongoDB,
    }),
  })
);

app.use(passport.initialize());
app.use(passport.authenticate("session"));
// app.use(passport.session());

export let ensureUserAuthorized = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    let auth = req.headers.authorization;

    if (!auth) {
      res.status(401).send("Unauthorized");
    } else {
      let token = auth.split(" ")[1];
      let user = jwt.verify(token as string, process.env.SALT || "SALT");

      req.session.user = user;
      next();
    }
  } catch (err) {
    res.status(401).send("Please send a valid access token in the header");
  }
};

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Tickets");
});

app.use("/users", usersRoute);
app.use("/events", eventsRoute);
app.use("/momo", momoRoute);
app.use("/tickets", ticketsRoute);

app.listen(PORT, () => {
  console.log(`⚡️[server]: Server is running at ${PORT}`);
});
