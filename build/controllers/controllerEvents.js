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
exports.createTicket = exports.getEventById = exports.getAllEvents = void 0;
const events_1 = require("../models/events");
function getAllEvents() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let events = yield events_1.eventModel.find({});
            return events;
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.getAllEvents = getAllEvents;
function getEventById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let event = yield events_1.eventModel.findById(id);
            return event;
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.getEventById = getEventById;
function createTicket(eventDoc) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let newEvent = new events_1.eventModel(eventDoc);
            let event = yield newEvent.save();
            return event;
        }
        catch (err) {
            throw Error(`${err}`);
        }
    });
}
exports.createTicket = createTicket;
