"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureUserAuthorized = void 0;
const express_1 = __importDefault(require("express"));
const bodyParser = require("body-parser");
const session = require("express-session");
const cors = require("cors");
const passport = require("passport");
const MongoStore = require("connect-mongo");
const mongoose_1 = __importDefault(require("mongoose"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const routeUsers_1 = __importDefault(require("./routes/routeUsers"));
const routeEvents_1 = __importDefault(require("./routes/routeEvents"));
const routeMomo_1 = __importDefault(require("./routes/routeMomo"));
const routeTickets_1 = __importDefault(require("./routes/routeTickets"));
// dotenv.config();
const PORT = 8081;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
//Set up default mongoose connection
// var mongoDB = `mongodb://${DB_USER}:${DB_PASSWORD}@127.0.0.1:27017/dapproval-user-service?authSource=admin`;
var mongoDB = process.env.TICKETS_DB ||
    `mongodb+srv://mongo-admin:2tij6e0anAgKU6tb@myfreecluster.kxvgw.mongodb.net/tickets?retryWrites=true&w=majority`;
mongoose_1.default.connect(mongoDB);
//Get the default connection
var db = mongoose_1.default.connection;
//Bind connection to error event (to get notification of connection errors)
db.on("error", console.error.bind(console, "MongoDB connection error:"));
// db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("connected to db"));
//Basic Authorization
let auth = (req, res, next) => {
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
const app = (0, express_1.default)();
app.use(cors());
// app.use(auth);
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "5mb" }));
app.use(cors());
// app.use(auth)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
    secret: "keyboard cat",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: mongoDB,
    }),
}));
app.use(passport.initialize());
app.use(passport.authenticate("session"));
// app.use(passport.session());
let ensureUserAuthorized = (req, res, next) => {
    try {
        let auth = req.headers.authorization;
        if (!auth) {
            res.status(401).send("Unauthorized");
        }
        else {
            let token = auth.split(" ")[1];
            let user = jsonwebtoken_1.default.verify(token, process.env.SALT || "SALT");
            req.session.user = user;
            next();
        }
    }
    catch (err) {
        res.status(401).send("Please send a valid access token in the header");
    }
};
exports.ensureUserAuthorized = ensureUserAuthorized;
app.get("/", (req, res) => {
    res.send("Welcome to Tickets");
});
app.use("/users", routeUsers_1.default);
app.use("/events", routeEvents_1.default);
app.use("/momo", routeMomo_1.default);
app.use("/tickets", routeTickets_1.default);
app.listen(PORT, () => {
    console.log(`⚡️[server]: Server is running at ${PORT}`);
});
