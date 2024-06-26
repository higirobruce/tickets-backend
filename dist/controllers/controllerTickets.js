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
exports.updateTicket = exports.getTicketById = exports.getAllTickets = void 0;
const tickets_1 = require("../models/tickets");
function getAllTickets() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let tickets = yield tickets_1.ticketModel.find({ event: "64a72d14ef9fc1c25561e7e9" });
            return tickets;
        }
        catch (err) {
            console.log(err);
            throw Error(`${err}`);
        }
    });
}
exports.getAllTickets = getAllTickets;
function getTicketById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let ticket = yield tickets_1.ticketModel.findById(id);
            return ticket;
        }
        catch (err) {
            console.log(err);
            throw Error(`${err}`);
        }
    });
}
exports.getTicketById = getTicketById;
function updateTicket(id, updates) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let ticket = yield tickets_1.ticketModel.findByIdAndUpdate(id, { $set: updates });
            return ticket;
        }
        catch (err) {
            console.log(err);
            throw Error(`${err}`);
        }
    });
}
exports.updateTicket = updateTicket;
function createTicket(ticketDoc) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let newTicket = new tickets_1.ticketModel(ticketDoc);
            let ticket = yield newTicket.save();
            return ticket;
        }
        catch (err) {
            console.log(err);
            throw Error(`${err}`);
        }
    });
}
exports.default = createTicket;
