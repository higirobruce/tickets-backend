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
const controllerEvents_1 = require("../controllers/controllerEvents");
let router = (0, express_1.Router)();
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.send(yield (0, controllerEvents_1.getAllEvents)());
}));
router.get("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    res.send(yield (0, controllerEvents_1.getEventById)((_a = req === null || req === void 0 ? void 0 : req.params) === null || _a === void 0 ? void 0 : _a.id));
}));
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Bodyyyyy", req.body);
    res.send(yield (0, controllerEvents_1.createTicket)(req.body));
}));
exports.default = router;
