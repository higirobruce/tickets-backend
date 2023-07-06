"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userModel = exports.userSchema = exports.phoneNumberSchema = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
exports.phoneNumberSchema = new mongoose_1.default.Schema({
    countryCode: String,
    phone: String,
});
exports.userSchema = new mongoose_1.default.Schema({
    lastName: {
        type: String,
    },
    firstName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    otp: {
        type: String,
    },
    password: String,
    profilePictureUrl: String,
    status: String,
    phoneNumber: {
        type: exports.phoneNumberSchema,
    },
}, { timestamps: true, strict: true });
exports.userModel = mongoose_1.default.model("users", exports.userSchema);
