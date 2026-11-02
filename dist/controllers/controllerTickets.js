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
exports.getAllTickets = getAllTickets;
exports.getTicketById = getTicketById;
exports.getTicketByNumber = getTicketByNumber;
exports.updateTicket = updateTicket;
exports.default = createTicket;
const tickets_1 = require("../models/tickets");
function getAllTickets() {
    return __awaiter(this, arguments, void 0, function* (scope = {}) {
        return tickets_1.ticketModel.find(scope).sort({ createdAt: -1 });
    });
}
function getTicketById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return tickets_1.ticketModel.findById(id);
    });
}
function getTicketByNumber(number) {
    return __awaiter(this, void 0, void 0, function* () {
        return tickets_1.ticketModel.findOne({ number });
    });
}
function updateTicket(id, updates) {
    return __awaiter(this, void 0, void 0, function* () {
        return tickets_1.ticketModel.findByIdAndUpdate(id, { $set: updates }, { new: true });
    });
}
function createTicket(ticketDoc) {
    return __awaiter(this, void 0, void 0, function* () {
        const newTicket = new tickets_1.ticketModel(ticketDoc);
        return newTicket.save();
    });
}
