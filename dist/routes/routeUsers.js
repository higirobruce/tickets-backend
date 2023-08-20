"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const controllerUsers_1 = require("../controllers/controllerUsers");
const users_1 = require("../services/users");
let router = (0, express_1.Router)();
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.send(yield (0, controllerUsers_1.getAllUsers)());
}));
router.get("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let { id } = req.params;
    res.send(yield (0, controllerUsers_1.getUserById)(id));
}));
router.post("/login", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let { username, password } = req.body;
    let user = yield (0, controllerUsers_1.getUser)(username, password);
    req.session.user = user;
    res.send(user);
}));
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("helllooooo");
    let { lastName, firstName, email, password, phoneNumber } = req.body;
    let hashedPassword = (0, users_1.hashPassword)(password);
    res.send(yield (0, controllerUsers_1.saveUser)({
        lastName,
        firstName,
        email,
        password: hashedPassword,
        phoneNumber,
    }));
}));
exports.default = router;
